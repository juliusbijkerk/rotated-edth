import { connect } from './ws';

const UNITS = ['Alpha', 'Bravo', 'Charlie'];

const picker = document.getElementById('picker')!;
const ptBtn = document.getElementById('ptt') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const lastEl = document.getElementById('last')!;
const sessionEl = document.getElementById('session')!;
const changeUnitBtn = document.getElementById('change-unit') as HTMLButtonElement;
const micStateEl = document.getElementById('mic-state')!;
const locationStateEl = document.getElementById('location-state')!;
const stageStrip = document.getElementById('stage-strip')!;
const manualForm = document.getElementById('manual-report') as HTMLFormElement;
const manualText = document.getElementById('manual-text') as HTMLTextAreaElement;

let selectedUnit: string | null = null;
let ws: ReturnType<typeof connect> | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mediaStream: MediaStream | null = null;
let recStartedAt = 0;
const MIN_RECORDING_MS = 650;

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

function setStage(stage: string) {
  stageStrip.querySelectorAll('span').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-stage') === stage);
    el.classList.toggle('done', stageOrder(el.getAttribute('data-stage') || '') < stageOrder(stage));
  });
}

function stageOrder(stage: string): number {
  return ['link', 'mic', 'sent', 'stt', 'parse', 'ground', 'done'].indexOf(stage);
}

function setPermission(el: Element, state: string, tone: 'wait' | 'ok' | 'bad' = 'wait') {
  el.textContent = state;
  el.className = tone;
}

for (const u of UNITS) {
  const btn = document.createElement('button');
  btn.textContent = u;
  btn.className = `unit-pick unit-${u.toLowerCase()}`;
  btn.addEventListener('click', () => joinAs(u));
  picker.appendChild(btn);
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

async function joinAs(unit: string) {
  if (selectedUnit) leaveUnit();
  selectedUnit = unit;
  picker.style.display = 'none';
  sessionEl.style.display = 'flex';
  document.querySelectorAll('.unit-label-display').forEach((el) => (el.textContent = unit));
  ws = connect(`/ws/unit/${unit}`);
  setStage('link');
  setPermission(locationStateEl, 'requesting', 'wait');
  ws.onOpen(() => {
    setStatus(`connected as ${unit}`);
    setStage('mic');
  });
  ws.onClose(() => setStatus('disconnected'));
  ws.onMessage((msg) => {
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as any;
    if (m.type === 'report_echo') {
      const r = m.report;
      const res = r.resolved || {};
      const headText = `${res.method || '?'}` + (res.poi_name ? ` · ${res.poi_name}` : '');
      lastEl.innerHTML =
        `<div class="echo-head">${escapeText(headText)}</div>` +
        `<div class="echo-text">${escapeText(r.transcript || '')}</div>`;
      setStatus(`ready · ${res.needs_review ? 'review' : res.method || '—'}`);
      setStage('done');
    } else if (m.type === 'status') {
      setStatus(m.message || m.stage || 'processing…');
      if (m.stage) setStage(m.stage);
    } else if (m.type === 'error') {
      setStatus(`error: ${m.stage} ${m.error}`);
      setStage('link');
    }
  });
  await Promise.all([requestMic(), requestLocation()]);
}

function leaveUnit() {
  ws?.close();
  ws = null;
  selectedUnit = null;
  if (recorder && recorder.state === 'recording') recorder.stop();
  recorder = null;
  chunks = [];
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  ptBtn.disabled = false;
  ptBtn.classList.remove('live');
  ptBtn.classList.remove('disabled');
}

function escapeText(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function requestMic() {
  ptBtn.disabled = false;
  ptBtn.classList.remove('disabled');
  if (!navigator.mediaDevices?.getUserMedia) {
    ptBtn.disabled = true;
    ptBtn.classList.add('disabled');
    setPermission(micStateEl, 'blocked', 'bad');
    setStatus('mic requires HTTPS or localhost; use typed report or open the HTTPS tunnel URL');
    return;
  }
  setPermission(micStateEl, 'requesting', 'wait');
  setStatus('requesting mic…');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    setPermission(micStateEl, 'ready', 'ok');
    setStage('mic');
  } catch (e: any) {
    const msg = e?.message || e?.name || 'permission denied';
    ptBtn.disabled = true;
    ptBtn.classList.add('disabled');
    setPermission(micStateEl, 'denied', 'bad');
    setStatus(`mic unavailable: ${msg}; use typed report`);
  }
}

async function requestLocation() {
  if (!navigator.geolocation) {
    setPermission(locationStateEl, 'unavailable', 'bad');
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    });
    setPermission(locationStateEl, 'available', 'ok');
  } catch (e: any) {
    setPermission(locationStateEl, e?.code === 1 ? 'denied' : 'limited', e?.code === 1 ? 'bad' : 'wait');
  }
}

function startRec() {
  if (!ws || !mediaStream) return;
  if (recorder && recorder.state === 'recording') return;
  const mime = pickMimeType();
  recorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
    if (Date.now() - recStartedAt < MIN_RECORDING_MS || blob.size < 1024) {
      setStatus('no usable audio captured; hold longer');
      return;
    }
    setStatus(`sending ${(blob.size / 1024).toFixed(1)} KB…`);
    setStage('sent');
    if (ws && blob.size > 0) {
      const buf = await blob.arrayBuffer();
      ws.send({ type: 'audio_meta', mime_type: blob.type });
      ws.ws.send(buf);
      setStatus('processing…');
    } else {
      setStatus('no audio captured');
    }
  };
  recorder.start();
  recStartedAt = Date.now();
  ptBtn.classList.add('live');
  setStatus('listening…');
  setStage('mic');
}

function stopRec() {
  ptBtn.classList.remove('live');
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
}

function sendTypedReport() {
  const transcript = manualText.value.trim();
  if (!transcript) return;
  if (!ws || ws.ws.readyState !== WebSocket.OPEN) {
    setStatus('not connected');
    return;
  }
  ws.send({ type: 'text_report', transcript });
  manualText.value = '';
  setStatus('processing typed report…');
  setStage('parse');
}

ptBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  ptBtn.setPointerCapture?.(e.pointerId);
  startRec();
});
ptBtn.addEventListener('pointerup', (e) => {
  e.preventDefault();
  stopRec();
});
ptBtn.addEventListener('pointercancel', stopRec);
ptBtn.addEventListener('lostpointercapture', stopRec);
manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendTypedReport();
});
changeUnitBtn.addEventListener('click', () => {
  leaveUnit();
  sessionEl.style.display = 'none';
  picker.style.display = 'flex';
  document.querySelectorAll('.unit-label-display').forEach((el) => (el.textContent = 'UNIT'));
  setStatus('ready');
  setStage('link');
  setPermission(micStateEl, 'waiting', 'wait');
  setPermission(locationStateEl, 'waiting', 'wait');
});

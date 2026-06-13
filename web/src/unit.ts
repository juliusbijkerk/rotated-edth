import { connect } from './ws';

const UNITS = ['Alpha', 'Bravo', 'Charlie'];

const picker = document.getElementById('picker')!;
const ptBtn = document.getElementById('ptt') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const statusTextEl = document.getElementById('status-text')!;
const lastEl = document.getElementById('last')!;
const sessionEl = document.getElementById('session')!;
const changeUnitBtn = document.getElementById('change-unit') as HTMLButtonElement;
const manualForm = document.getElementById('manual-report') as HTMLFormElement;
const manualText = document.getElementById('manual-text') as HTMLTextAreaElement;

let selectedUnit: string | null = null;
let ws: ReturnType<typeof connect> | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mediaStream: MediaStream | null = null;
let recStartedAt = 0;
const MIN_RECORDING_MS = 650;  // reject accidental taps (the source of garbage reports)

type StatusState = '' | 'processing' | 'done' | 'error';
function setStatus(msg: string, state: StatusState = '') {
  statusTextEl.textContent = msg;
  statusEl.className = 'status' + (state ? ' ' + state : '');
}

function escapeText(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
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
  // mp4 first — iOS Safari records AAC/mp4, not webm.
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m;
  return undefined;
}

const PROGRESS_LABELS: Record<string, string> = {
  received: 'received ✓',
  transcribed: 'heard you — understanding…',
  understanding: 'understanding…',
  locating: 'placing on map…',
  routing: 'tracing the route…',
};

async function joinAs(unit: string) {
  if (selectedUnit) leaveUnit();
  selectedUnit = unit;
  picker.style.display = 'none';
  sessionEl.style.display = 'flex';
  changeUnitBtn.style.display = '';
  document.querySelectorAll('.unit-label-display').forEach((el) => (el.textContent = unit));
  ws = connect(`/ws/unit/${unit}`);
  ws.onOpen(() => setStatus(`connected as ${unit}`));
  ws.onClose(() => setStatus('disconnected — reconnecting…', 'error'));
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
      if (res.needs_review) setStatus('placed (needs review) — try again?', 'error');
      else setStatus(`placed ✓ · ${res.method || '—'}`, 'done');
    } else if (m.type === 'progress') {
      setStatus(PROGRESS_LABELS[m.stage] || m.stage, 'processing');
      if (m.stage === 'transcribed' && m.transcript) {
        lastEl.innerHTML =
          `<div class="echo-head">transcript</div>` +
          `<div class="echo-text">${escapeText(m.transcript)}</div>`;
      }
    } else if (m.type === 'error') {
      setStatus(`error: ${m.stage} — ${m.error}`, 'error');
    }
  });
  await requestMic();
}

function leaveUnit() {
  ws?.close();
  ws = null;
  if (recorder && recorder.state === 'recording') recorder.stop();
  recorder = null;
  chunks = [];
  selectedUnit = null;
  ptBtn.classList.remove('live', 'disabled');
  ptBtn.disabled = false;
}

async function requestMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    ptBtn.disabled = true;
    ptBtn.classList.add('disabled');
    setStatus('mic needs HTTPS — type your report below ↓', 'error');
    return;
  }
  setStatus('requesting mic…', 'processing');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    setStatus('ready · hold to talk');
  } catch (e: any) {
    ptBtn.disabled = true;
    ptBtn.classList.add('disabled');
    setStatus(`mic blocked (${e?.name || 'denied'}) — type your report below ↓`, 'error');
  }
}

function startRec() {
  if (!ws || !mediaStream) return;
  if (recorder && recorder.state === 'recording') return;
  const mime = pickMimeType();
  recorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
    if (Date.now() - recStartedAt < MIN_RECORDING_MS || blob.size < 1024) {
      setStatus('too short — hold the button while you speak', 'error');
      return;
    }
    setStatus(`sending ${(blob.size / 1024).toFixed(1)} KB…`, 'processing');
    if (ws && blob.size > 0) {
      const buf = await blob.arrayBuffer();
      ws.send({ type: 'audio_meta', mime_type: blob.type });  // advisory container hint
      ws.ws.send(buf);
      setStatus('processing…', 'processing');
    } else {
      setStatus('no audio captured', 'error');
    }
  };
  recorder.start();
  recStartedAt = Date.now();
  ptBtn.classList.add('live');
  setStatus('listening…', 'processing');
}

function stopRec() {
  ptBtn.classList.remove('live');
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function sendTypedReport() {
  const transcript = manualText.value.trim();
  if (!transcript) return;
  if (!ws || ws.ws.readyState !== WebSocket.OPEN) { setStatus('not connected', 'error'); return; }
  ws.send({ type: 'text_report', transcript });
  manualText.value = '';
  setStatus('processing typed report…', 'processing');
}

// Pointer events + capture: the button stays "held" even if the thumb slides off it.
ptBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); ptBtn.setPointerCapture?.(e.pointerId); startRec(); });
ptBtn.addEventListener('pointerup', (e) => { e.preventDefault(); stopRec(); });
ptBtn.addEventListener('pointercancel', stopRec);
ptBtn.addEventListener('lostpointercapture', stopRec);

manualForm.addEventListener('submit', (e) => { e.preventDefault(); sendTypedReport(); });

changeUnitBtn.addEventListener('click', () => {
  leaveUnit();
  sessionEl.style.display = 'none';
  changeUnitBtn.style.display = 'none';
  picker.style.display = 'flex';
  document.querySelectorAll('.unit-label-display').forEach((el) => (el.textContent = 'UNIT'));
  setStatus('ready');
});

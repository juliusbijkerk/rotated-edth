import { connect } from './ws';

const UNITS = ['Alpha', 'Bravo', 'Charlie'];

const picker = document.getElementById('picker')!;
const ptBtn = document.getElementById('ptt') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const lastEl = document.getElementById('last')!;
const sessionEl = document.getElementById('session')!;
const manualForm = document.getElementById('manual-report') as HTMLFormElement;
const manualText = document.getElementById('manual-text') as HTMLTextAreaElement;

let selectedUnit: string | null = null;
let ws: ReturnType<typeof connect> | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mediaStream: MediaStream | null = null;

function setStatus(msg: string) {
  statusEl.textContent = msg;
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
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

async function joinAs(unit: string) {
  if (selectedUnit) return;
  selectedUnit = unit;
  picker.style.display = 'none';
  sessionEl.style.display = 'flex';
  document.querySelectorAll('.unit-label-display').forEach((el) => (el.textContent = unit));
  ws = connect(`/ws/unit/${unit}`);
  ws.onOpen(() => setStatus(`connected as ${unit}`));
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
      setStatus(`ready · ${res.method || '—'}`);
    } else if (m.type === 'error') {
      setStatus(`error: ${m.stage} ${m.error}`);
    }
  });
  await requestMic();
}

function escapeText(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

async function requestMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    ptBtn.disabled = true;
    ptBtn.classList.add('disabled');
    setStatus('mic requires HTTPS or localhost; use typed report or open the HTTPS tunnel URL');
    return;
  }
  setStatus('requesting mic…');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e: any) {
    const msg = e?.message || e?.name || 'permission denied';
    ptBtn.disabled = true;
    ptBtn.classList.add('disabled');
    setStatus(`mic unavailable: ${msg}; use typed report`);
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
    setStatus(`sending ${(blob.size / 1024).toFixed(1)} KB…`);
    if (ws && blob.size > 0) {
      const buf = await blob.arrayBuffer();
      ws.ws.send(buf);
      setStatus('processing…');
    } else {
      setStatus('no audio captured');
    }
  };
  recorder.start();
  ptBtn.classList.add('live');
  setStatus('listening…');
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
}

ptBtn.addEventListener('mousedown', startRec);
ptBtn.addEventListener('mouseup', stopRec);
ptBtn.addEventListener('mouseleave', stopRec);
ptBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRec(); });
ptBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRec(); });
ptBtn.addEventListener('touchcancel', stopRec);
manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendTypedReport();
});

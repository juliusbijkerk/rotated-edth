export interface WSClient {
  ws: WebSocket;
  send(msg: unknown): void;
  close(): void;
  onMessage(cb: (msg: unknown) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
}

export function connect(path: string): WSClient {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}${path}`);
  const handlers = {
    msg: [] as ((m: unknown) => void)[],
    open: [] as (() => void)[],
    close: [] as (() => void)[],
  };
  ws.addEventListener('open', () => handlers.open.forEach((h) => h()));
  ws.addEventListener('close', () => handlers.close.forEach((h) => h()));
  ws.addEventListener('message', (ev) => {
    let parsed: unknown = ev.data;
    if (typeof ev.data === 'string') {
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        // Leave as string.
      }
    }
    handlers.msg.forEach((h) => h(parsed));
  });
  return {
    ws,
    send: (msg) => ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)),
    close: () => ws.close(),
    onMessage: (cb) => handlers.msg.push(cb),
    onOpen: (cb) => handlers.open.push(cb),
    onClose: (cb) => handlers.close.push(cb),
  };
}

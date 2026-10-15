// WebSocket with capped exponential reconnect. Reports status changes so
// the UI can show whether data is live.
export function reconnectingSocket(url, { onOpen, onMessage, onStatus }) {
  let ws;
  let attempt = 0;
  let stopped = false;
  let timer;

  function connect() {
    onStatus?.("connecting");
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      attempt = 0;
      onStatus?.("live");
      onOpen?.(ws);
    });
    ws.addEventListener("message", (e) => {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage(data);
    });
    ws.addEventListener("close", () => {
      if (stopped) return;
      onStatus?.("reconnecting");
      const delay = Math.min(30_000, 1000 * 2 ** attempt++);
      timer = setTimeout(connect, delay);
    });
  }

  connect();
  return {
    send(payload) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    },
    get open() {
      return ws.readyState === WebSocket.OPEN;
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      ws.close();
    },
  };
}

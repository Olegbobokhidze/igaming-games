import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env['MOCK_SERVER_PORT'] ?? 8080);
const HEARTBEAT_INTERVAL_MS = 1000;

const server = new WebSocketServer({ port: PORT });

/** Monotonic counter shared by all clients, so gaps are visible. */
let seq = 0;

const interval = setInterval(() => {
  seq += 1;
  const frame = JSON.stringify({ type: 'heartbeat', ts: Date.now(), seq });
  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(frame);
    }
  }
}, HEARTBEAT_INTERVAL_MS);

server.on('connection', (socket, request) => {
  console.log(
    `[mock] client connected from ${request.socket.remoteAddress ?? 'unknown'}`,
  );
  socket.on('close', () => console.log('[mock] client disconnected'));
  socket.on('error', (error) => console.error('[mock] socket error:', error));
});

server.on('listening', () => {
  console.log(`[mock] websocket server listening on ws://localhost:${PORT}`);
});

server.on('error', (error) => {
  console.error('[mock] server error:', error);
});

const shutdown = (): void => {
  clearInterval(interval);
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// TODO(stage-2): replace the heartbeat with a real round loop that drives
// betting/launch/crash frames from a seeded RNG.

import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

const roomId = 'promo-regression-room';
const room = {
  roomId, name: 'Playlist Regression University', hostParticipantId: 'fixture-person',
  capacity: 100, createdAt: '2026-01-01T00:00:00Z', participants: [],
};
const sessionId = 'synthetic-room-session';
const messages = Array.from({ length: 60 }, (_, i) => ({
  id: `fixture-message-${i}`, roomId, authorId: 'fixture-person', username: 'fixture',
  kind: 'text', text: `Synthetic history row ${i + 1}: browser layout regression.`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
}));

function isolatedRoomResponses(): Plugin {
  return {
    name: 'isolated-promo-room-responses',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url!, 'http://fixture.invalid').pathname;
        if (!pathname.startsWith('/api/')) return next();
        const endpoint = `/api/account/rooms/${roomId}`;
        const json = (value: unknown) => {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));
        };
        if (pathname === `${endpoint}/join` && req.method === 'POST')
          return json({ participantSessionId: sessionId, participantId: 'fixture-person', room });
        // This legacy endpoint authenticates by session in its URL, not a header.
        if (pathname === `/api/rooms/${roomId}/participants/${sessionId}/heartbeat` && req.method === 'POST')
          return json({ ok: true });
        if (req.headers['x-room-session'] !== sessionId) {
          res.statusCode = 403; return json({ error: 'Synthetic session required' });
        }
        if (pathname === `${endpoint}/events` && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write(`event: room.snapshot\ndata: ${JSON.stringify(room)}\n\n`);
          const keepAlive = setInterval(() => res.write(': fixture keepalive\n\n'), 1000);
          res.on('close', () => clearInterval(keepAlive));
          return;
        }
        if (pathname === `${endpoint}/messages` && req.method === 'GET') return json(messages);
        if (pathname === `${endpoint}/university-session` && req.method === 'GET')
          return json({
            people: [{
              participantId: 'fixture-person', username: 'fixture', displayName: 'Fixture',
              photoUrl: null, photoStatus: null, self: true, moderator: false, ignored: false,
            }],
            ignoredUsernames: [], topic: 'A long synthetic topic for testing phone header clearance',
            rulesSeen: true, whispers: [],
          });
        // Fail closed: no profile writes, message sends, moderation or real API proxy.
        res.statusCode = 501;
        json({ error: `Unexpected fixture API request: ${req.method} ${pathname}` });
      });
    },
  };
}

export default defineConfig({
  root: path.resolve(import.meta.dirname, '../..'),
  base: '/',
  define: { __PROMO_REGRESSION__: 'true' },
  plugins: [react(), tailwindcss({ optimize: false }), isolatedRoomResponses()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '../../src') },
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '127.0.0.1', port: 4317, strictPort: true },
});

import path from 'node:path';
import type { ServerResponse } from 'node:http';
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
  const listeners = new Set<ServerResponse>();
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
        if (pathname === '/api/social/blocks' && req.method === 'GET') return json({ people: [] });
        if (pathname === '/api/account/live-streams/layout-fixture/host-blocks' && req.method === 'GET')
          return json({ people: [] });
        if (pathname === '/api/account/live-streams/layout-fixture/chat/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write(`event: message\ndata: ${JSON.stringify({
            id: 'layout-comment', username: 'viewer', displayName: 'Viewer', displayNameTierIndex: 96,
            text: 'A readable viewer comment', createdAt: new Date().toISOString(),
          })}\n\n`);
          res.write(`event: gift-history-item\ndata: ${JSON.stringify({
            id: 'layout-gift', senderUsername: 'viewer', senderName: 'Viewer', giftId: 'heart',
            giftName: 'Heart', quantity: 10, cost: 100, createdAt: '2020-01-01T00:00:00Z',
          })}\n\n`);
          const keepAlive = setInterval(() => res.write(': fixture keepalive\n\n'), 1000);
          res.on('close', () => clearInterval(keepAlive));
          return;
        }
        if (pathname === '/api/account/live-streams/layout-fixture/chat' && req.method === 'POST')
          return json({ ok: true });
        if (pathname === '/api/social/me' && req.method === 'GET')
          return json({
            profile: { username: 'fixture', displayName: 'Fixture', photoUrl: null },
            nameColorProgress: { tierIndex: 11, lifetimeCoinsPurchased: 5500 },
            wallet: { balance: 1234 }, inventory: [], products: [], gifts: [],
          });
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
          listeners.add(res);
          const keepAlive = setInterval(() => res.write(': fixture keepalive\n\n'), 1000);
          res.on('close', () => { clearInterval(keepAlive); listeners.delete(res); });
          return;
        }
        if (pathname === `${endpoint}/messages` && req.method === 'GET') return json(messages);
        // Synthetic room only: exercise real composer + SSE consumers without
        // allowing any request to reach the application's database or API.
        if (pathname === `${endpoint}/messages` && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            const input = JSON.parse(body);
            if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 280) {
              res.statusCode = 400; return json({ error: 'Invalid fixture comment' });
            }
            const message = {
              id: `fixture-comment-${messages.length}`, roomId, authorId: 'fixture-person', username: 'fixture',
              kind: input.kind ?? 'text', text: input.text.trim(), createdAt: new Date().toISOString(),
            };
            messages.push(message);
            const accepted = { message };
            for (const client of listeners) client.write(`event: chat.accepted\ndata: ${JSON.stringify(accepted)}\n\n`);
            return json(accepted);
          });
          return;
        }
        if (pathname === `/api/social/gifts/rooms/${roomId}` && req.method === 'GET') return json({ events: [] });
        if (pathname === `${endpoint}/university-session` && req.method === 'GET')
          return json({
            people: [{
              participantId: 'fixture-person', username: 'fixture', displayName: 'Fixture',
              photoUrl: null, photoStatus: null, self: true, moderator: false, ignored: false,
            }],
            ignoredUsernames: [], topic: 'A long synthetic topic for testing phone header clearance',
            rulesSeen: true, whispers: [],
          });
        // Fail closed: no profile writes, moderation or real API proxy.
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

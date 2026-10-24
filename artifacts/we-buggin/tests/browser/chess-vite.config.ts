import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

// Synthetic chess API: never proxies to a real server, account or database.
const portrait = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#716448"/><path fill="#ffd47a" d="M0 0h120v15H0zM0 165h120v15H0z"/><text x="60" y="90" text-anchor="middle" fill="white" font-size="16">Full photo</text></svg>');
const landscape = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#354d69"/><text x="90" y="65" text-anchor="middle" fill="white" font-size="16">Second photo</text></svg>');
const white = { accountId: 'fx-white', username: 'ivory_rook', displayName: 'Mireille Ashdown', photoUrl: portrait,
  photoUrls: [portrait, landscape], giftingLevel: 96 };
const black = { accountId: 'fx-black', username: 'ebon_knight', displayName: 'Tobias Venn', photoUrl: landscape,
  photoUrls: [landscape, portrait], giftingLevel: 31 };
const START = 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1';
const startMoves = [
  ...['q', 'r', 'b', 'n'].map(p => ({ from: 'e7', to: 'e8', promotion: p })),
  ...['d1', 'f1', 'd2', 'e2', 'f2'].map(to => ({ from: 'e1', to })),
];
function fresh() {
  return { roomId: 'fx-chess', fen: START, players: { white, black: black as typeof black | null }, turn: 'w', status: 'playing', revision: 3,
    yourColor: 'w', rematchRequestedBy: null as string | null, result: null as string | null, inCheck: false, legalMoves: startMoves };
}
let state = fresh();
let joinFailures = 0;
let getFails = false;
const actions: unknown[] = [];

function chessFixture(): Plugin {
  return { name: 'chess-fixture', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://fixture');
      const json = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
      const body = () => new Promise<any>(resolve => { let d = ''; req.on('data', c => { d += c; }); req.on('end', () => resolve(d ? JSON.parse(d) : {})); });
      if (url.pathname === '/__fixture/reset') {
        state = fresh(); joinFailures = Number(url.searchParams.get('joinFail') ?? 0); getFails = false; actions.length = 0;
        if (url.searchParams.has('black')) state = { ...state, yourColor: 'b', legalMoves: [] };
        if (url.searchParams.has('waiting')) state = { ...state, players: { white, black: null }, status: 'waiting', legalMoves: [] };
        return json(200, { ok: true });
      }
      if (url.pathname === '/__fixture/get-fails') { getFails = url.searchParams.get('on') === '1'; return json(200, { ok: true }); }
      if (url.pathname === '/__fixture/actions') return json(200, actions);
      if (!url.pathname.startsWith('/api/')) return next();
      const m = url.pathname.match(/^\/api\/social\/chess\/rooms\/([^/]+)(\/join|\/actions|\/audio)?$/);
      if (!m) return json(501, { error: `Unexpected fixture API request ${url.pathname}` });
      if (m[2] === '/join') { if (joinFailures > 0) { joinFailures--; return json(409, { error: 'full' }); } return json(200, state); }
      if (m[2] === '/audio') return json(503, { error: 'no audio in fixture' });
      if (m[2] === '/actions') return void body().then(input => {
        actions.push(input);
        if (input.revision !== state.revision) return json(409, { error: 'revision conflict' });
        if (input.action === 'move' && input.from === 'e7') {
          state = { ...state, fen: `k3${String(input.promotion).toUpperCase()}3/8/8/8/8/8/8/4K3 b - - 0 1`, turn: 'b', status: 'checkmate',
            result: 'White wins by checkmate.', revision: state.revision + 1, legalMoves: [] };
        } else if (input.action === 'move') {
          state = { ...state, fen: 'k7/4P3/8/8/8/8/4K3/8 b - - 1 1', turn: 'b', revision: state.revision + 1, legalMoves: [] };
        } else if (input.action === 'rematch') state = { ...state, rematchRequestedBy: 'fx-white', revision: state.revision + 1 };
        json(200, state);
      });
      if (getFails) return json(503, { error: 'offline' });
      return json(200, state);
    });
  } };
}

export default defineConfig({
  root: path.resolve(import.meta.dirname, '../..'),
  base: '/',
  plugins: [react(), tailwindcss({ optimize: false }), chessFixture()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../../src') }, dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 4318, strictPort: true },
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { boardCells, isLegal, needsPromotion, resultTitle, selectableSquares } from '../src/chess/chess-logic';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
test('board is fixed with white pieces on top', () => {
  const cells = boardCells(START);
  assert.equal(cells.length, 64);
  assert.equal(cells[0].square, 'h1');
  assert.equal(cells[0].piece?.color, 'w');
  assert.equal(cells[63].square, 'a8');
  assert.equal(cells[63].piece?.color, 'b');
  assert.equal(cells.find(c => c.square === 'e1')?.piece?.type, 'k');
});
test('selection and legality come only from server legalMoves', () => {
  const moves = [{ from: 'e7', to: 'e8', promotion: 'q' }, { from: 'e7', to: 'e8', promotion: 'n' }, { from: 'g1', to: 'f3' }];
  assert.deepEqual([...selectableSquares(moves)].sort(), ['e7', 'g1']);
  assert.ok(needsPromotion(moves, 'e7', 'e8'));
  assert.ok(isLegal(moves, 'e7', 'e8', 'n'));
  assert.ok(!isLegal(moves, 'e7', 'e8', 'r'));
  assert.ok(!isLegal(moves, 'e2', 'e4'));
});
test('result titles', () => {
  assert.equal(resultTitle('checkmate', '1-0', 'w'), 'You won');
  assert.equal(resultTitle('resigned', '1-0', 'b'), 'You lost');
  assert.equal(resultTitle('stalemate', null, 'w'), 'Stalemate');
});
test('room source: generated hooks, no extra panels, mic-only audio, route before catch-all', () => {
  const room = readFileSync('src/chess/ChessRoom.tsx', 'utf8');
  const audio = readFileSync('src/chess/useChessAudio.ts', 'utf8');
  const social = readFileSync('src/social/SocialApp.tsx', 'utf8');
  const golive = readFileSync('src/chat/GoLiveScreens.tsx', 'utf8');
  assert.match(room, /useGetChessRoom/); assert.match(room, /joinChessRoom\(roomId\)/); assert.match(room, /refetchInterval: 1000/);
  assert.doesNotMatch(room, /[^e]fetch\(/); assert.doesNotMatch(room, /Gift|Chat|Seat/);
  assert.match(audio, /setMicrophoneEnabled\(true\)/); assert.doesNotMatch(audio, /Camera|video:/i);
  assert.ok(social.indexOf('/community/chess/:chessRoomId') < social.indexOf('<Route><div className="sc-empty"><h2>Not found'));
  assert.match(golive, /useCreateChessRoom/); assert.match(golive, /\/community\/chess\//);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screens = readFileSync('src/chat/GoLiveScreens.tsx', 'utf8');
const styles = readFileSync('src/chat/live-stream.css', 'utf8');

test('Go Live opens a two-choice dialog and preserves the existing full-screen broadcast path', () => {
  assert.match(screens, /aria-haspopup="dialog"/);
  assert.match(screens, /data-testid="dialog-go-live-choice"/);
  assert.match(screens, /data-testid="button-start-live-broadcast"/);
  assert.match(screens, /void hostLiveSession\.start\(username\)/);
  assert.match(screens, /navigate\("\/live\/start"\)/);
});

test('Create Room provisions a nine-seat social room, saves its session and opens it', () => {
  assert.match(screens, /data-testid="button-create-social-room"/);
  assert.match(screens, /useCreateAccountRoom/);
  assert.match(screens, /data:\s*\{\s*name:\s*roomName,\s*capacity:\s*9\s*\}/);
  assert.match(screens, /saveCreds\(user\.id,\s*session\.room\.roomId/);
  assert.match(screens, /navigate\(`\/rooms\/\$\{encodeURIComponent\(session\.room\.roomId\)\}`\)/);
});

test('the choice dialog remains usable at phone widths and supports keyboard close', () => {
  assert.match(screens, /event\.key === "Escape"/);
  assert.match(styles, /\.st-room-choice-scrim\s*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.st-room-choice-card\s*\{[^}]*width:\s*min\(100%,\s*420px\)/);
  assert.match(styles, /padding:\s*max\(16px,\s*env\(safe-area-inset-top\)\)/);
});

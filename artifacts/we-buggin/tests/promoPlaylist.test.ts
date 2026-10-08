import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMO_VIDEOS, advancePlaylist, initialPlaylistState } from '../src/chat/promo-playlist';

test('approved upload order includes the extra project and no duplicate or forest', () => {
  assert.deepEqual(PROMO_VIDEOS.map(v => v.file), [
    '01-immortal-studios.mp4', '02-moonlit-characters.mp4',
    '03-red-tunnel.mp4', '04-additional-project.mp4',
  ]);
});
test('one completion advances once in order and the fourth wraps back to first', () => {
  let state = initialPlaylistState(4);
  for (const expected of [1, 2, 3, 0, 1]) {
    state = advancePlaylist(state, 4, { type: 'ended', index: state.index, run: state.run });
    assert.equal(state.index, expected);
    assert.equal(state.stopped, false);
  }
});
test('a broken clip is skipped and does not block subsequent cycles', () => {
  let state = initialPlaylistState(4);
  state = advancePlaylist(state, 4, { type: 'failed', index: 0, run: 0 });
  assert.equal(state.index, 1);
  for (const expected of [2, 3, 1]) {
    state = advancePlaylist(state, 4, { type: 'ended', index: state.index, run: state.run });
    assert.equal(state.index, expected);
  }
});
test('all broken clips stop for a dark fallback instead of retrying forever', () => {
  let state = initialPlaylistState(4);
  for (let i = 0; i < 4; i++)
    state = advancePlaylist(state, 4, { type: 'failed', index: state.index, run: state.run });
  assert.equal(state.stopped, true);
  assert.equal(state.failed.length, 4);
});
test('stale and duplicate error/ended callbacks cannot skip a second clip', () => {
  const stale = { type: 'failed' as const, index: 0, run: 0 };
  const state = advancePlaylist(initialPlaylistState(4), 4, stale);
  assert.equal(advancePlaylist(state, 4, stale), state);
  assert.equal(advancePlaylist(state, 4, { ...stale, type: 'ended' }), state);
});
test('single playable video loops; an empty playlist safely stops', () => {
  assert.deepEqual(advancePlaylist(initialPlaylistState(1), 1, { type: 'ended', index: 0, run: 0 }),
    { index: 0, run: 1, failed: [], stopped: false });
  assert.equal(initialPlaylistState(0).stopped, true);
});

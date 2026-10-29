import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NYC_LOOP_PRELOAD_WINDOW_SECONDS,
  NYC_LOOP_START_WINDOW_SECONDS,
  shouldPreloadNycLoopStandby,
  shouldStartNycLoopCrossfade,
} from '../src/chat/nyc-loop-video-policy';

test('starts the crossfade only near the end when the next frame is ready', () => {
  assert.equal(shouldStartNycLoopCrossfade(NYC_LOOP_START_WINDOW_SECONDS + 0.1, 2), false);
  assert.equal(shouldStartNycLoopCrossfade(0.5, 1), false);
  assert.equal(shouldStartNycLoopCrossfade(0.5, 2), true);
  assert.equal(shouldStartNycLoopCrossfade(Number.NaN, 2), false);
});

test('preloads the standby video shortly before the loop seam', () => {
  assert.equal(shouldPreloadNycLoopStandby(NYC_LOOP_PRELOAD_WINDOW_SECONDS + 0.1), false);
  assert.equal(shouldPreloadNycLoopStandby(2), true);
  assert.equal(shouldPreloadNycLoopStandby(0.2), true);
});

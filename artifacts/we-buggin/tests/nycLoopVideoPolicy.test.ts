import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NYC_LOOP_PRELOAD_WINDOW_SECONDS,
  NYC_LOOP_START_WINDOW_SECONDS,
  shouldPreloadNycLoopStandby,
  shouldStartNycLoopCrossfade,
} from '../src/chat/nyc-loop-video-policy';
import {
  advanceHomeBackgroundPlaylist,
  shuffleHomeBackgroundVideos,
} from '../src/chat/nyc-background-videos';

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

test('Home plays every clip once per cycle, then reshuffles without an immediate repeat', () => {
  const original = ['one', 'two', 'three', 'four', 'five', 'six'];
  const firstOrder = shuffleHomeBackgroundVideos(original, () => 0);
  let videos = firstOrder;
  let position = 0;
  const cycle: string[] = [];

  for (let index = 0; index < original.length; index += 1) {
    cycle.push(videos[position]);
    const step = advanceHomeBackgroundPlaylist(videos, position, () => 0);
    videos = step.videos;
    position = step.nextPosition;
  }

  assert.deepEqual(new Set(cycle), new Set(original));
  assert.equal(cycle.length, original.length);
  assert.deepEqual([...videos].sort(), [...original].sort());
  assert.notEqual(videos[position], cycle[cycle.length - 1]);
});

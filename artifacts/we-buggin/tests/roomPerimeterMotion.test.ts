import assert from 'node:assert/strict';
import test from 'node:test';
import { roomPerimeterMotionFrames, ROOM_PERIMETER_DURATION_MS, ROOM_PERIMETER_LIGHT_SIZE } from '../src/chat/room-perimeter-motion';

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 844]]) {
  test(`transform-only shine remains on the rounded perimeter at ${width}x${height}`, () => {
    const frames = roomPerimeterMotionFrames(width!, height!);
    assert.equal(frames[0]!.offset, 0);
    assert.equal(frames.at(-1)!.offset, 1);
    let previous = 0;
    for (const frame of frames) {
      assert.ok(Number(frame.offset) >= previous);
      previous = Number(frame.offset);
      const values = String(frame.transform).match(/translate3d\(([-\d.e]+)px, ([-\d.e]+)px, 0\)/)!;
      const x = Number(values[1]) + ROOM_PERIMETER_LIGHT_SIZE / 2;
      const y = Number(values[2]) + ROOM_PERIMETER_LIGHT_SIZE / 2;
      assert.ok(x >= .999 && x <= width! - .999);
      assert.ok(y >= .999 && y <= height! - .999);
      assert.ok(Math.min(x, y, width! - x, height! - y) <= 12.001);
    }
    assert.equal(ROOM_PERIMETER_DURATION_MS, 12_000);
    assert.ok(frames.every(frame => Object.keys(frame).every(key => key === 'transform' || key === 'offset')));
  });
}

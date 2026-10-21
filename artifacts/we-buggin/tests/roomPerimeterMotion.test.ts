import assert from 'node:assert/strict';
import test from 'node:test';
import { roomPerimeterMotionFrames, ROOM_PERIMETER_DURATION_MS, ROOM_PERIMETER_LIGHT_SIZE } from '../src/chat/room-perimeter-motion';

const sizes = [[320, 568], [390, 844], [844, 390], [1280, 844]] as const;
const edges = ['top', 'right', 'bottom', 'left'] as const;

for (const [width, height] of sizes) {
  for (const edge of edges) {
    test(`transform-only shine stays on the ${edge} perimeter at ${width}x${height}`, () => {
      const frames = roomPerimeterMotionFrames(width, height, edge);
      assert.equal(frames[0]!.offset, 0);
      assert.equal(frames.at(-1)!.offset, 1);
      let previous = 0;
      for (const frame of frames) {
        assert.ok(Number(frame.offset) >= previous);
        previous = Number(frame.offset);
      }

      const horizontal = edge === 'top' || edge === 'bottom';
      const lightWidth = horizontal ? Math.min(ROOM_PERIMETER_LIGHT_SIZE, width) : 2;
      const lightHeight = horizontal ? 2 : Math.min(ROOM_PERIMETER_LIGHT_SIZE, height);
      const baseX = edge === 'right' ? width - 2 : 0;
      const baseY = edge === 'bottom' ? height - 2 : 0;
      for (const frame of frames.filter(item => Number(item.opacity) === 1)) {
        const values = String(frame.transform).match(/translate3d\(([-\d.e]+)(?:px)?, ([-\d.e]+)(?:px)?, 0\)/);
        assert.ok(values, `expected a compositor-friendly translate3d for ${edge}`);
        const left = baseX + Number(values![1]);
        const top = baseY + Number(values![2]);
        const x = left + lightWidth / 2;
        const y = top + lightHeight / 2;
        assert.ok(x >= 0 && x <= width);
        assert.ok(y >= 0 && y <= height);
        assert.ok(Math.min(x, y, width - x, height - y) <= 1.01);
      }

      assert.equal(ROOM_PERIMETER_DURATION_MS, 12_000);
      assert.ok(frames.every(frame =>
        Object.keys(frame).every(key => key === 'transform' || key === 'offset' || key === 'opacity'),
      ));
    });
  }
}

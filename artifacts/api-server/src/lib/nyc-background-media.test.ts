import assert from "node:assert/strict";
import test from "node:test";
import { parseNycBackgroundByteRange } from "./nyc-background-media";

test("NYC background stream supports full, bounded and suffix byte ranges", () => {
  assert.equal(parseNycBackgroundByteRange(null, 100), null);
  assert.deepEqual(parseNycBackgroundByteRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseNycBackgroundByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseNycBackgroundByteRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(parseNycBackgroundByteRange("bytes=0-999", 100), { start: 0, end: 99 });
});

test("NYC background stream rejects malformed and unsatisfiable ranges", () => {
  assert.equal(parseNycBackgroundByteRange("bytes=0-1,5-9", 100), false);
  assert.equal(parseNycBackgroundByteRange("bytes=-0", 100), false);
  assert.equal(parseNycBackgroundByteRange("bytes=100-", 100), false);
  assert.equal(parseNycBackgroundByteRange("bytes=4-2", 100), false);
});

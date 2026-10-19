import assert from "node:assert/strict";
import test from "node:test";
import {
  appendUniqueGiftEvents,
  buildGiftComboPlan,
  finishGiftQueueItem,
  giftCounterAfterLaunch,
  giftCounterAfterSkip,
} from "../src/gifts/gift-combo-policy";

test("gift combo count and timing follow the target curve, including custom quantities", () => {
  const cases: Array<[number, number, number]> = [
    [1, 6_000, 6_000],
    [10, 10_000, 10_000],
    [37, 12_411, 12_411],
    [66, 15_000, 15_000],
    [99, 18_000, 18_000],
    [188, 25_000, 25_000],
    [250, 27_801, 27_802],
    [520, 40_000, 40_000],
    [1314, 60_000, 90_000],
  ];
  for (const [quantity, lowerBound, upperBound] of cases) {
    const plan = buildGiftComboPlan(quantity);
    assert.equal(plan.miniLaunchOffsetsMs.length + 1, quantity, `${quantity} units are scheduled`);
    assert.ok(plan.totalDurationMs >= lowerBound - 40, `${quantity} completes near its lower target`);
    assert.ok(plan.totalDurationMs <= upperBound, `${quantity} completes within its upper target`);
    let counter = 1;
    for (let unit = 1; unit < quantity; unit += 1) counter = giftCounterAfterLaunch(counter, 1, quantity);
    assert.equal(counter, quantity, `${quantity} counter ends at ${quantity}/${quantity}`);
  }
});

test("the first unit remains a single full animation and reduced motion uses fewer, shorter minis", () => {
  const single = buildGiftComboPlan(1, 4321);
  assert.equal(single.totalDurationMs, 4321);
  assert.equal(single.miniLaunchOffsetsMs.length, 0);
  const normal = buildGiftComboPlan(1314);
  const reduced = buildGiftComboPlan(1314, 6000, true);
  assert.equal(normal.maxConcurrent, 20);
  assert.equal(reduced.maxConcurrent, 8);
  assert.equal(reduced.miniDurationMs, 360);
  assert.ok(reduced.totalDurationMs <= 90_000);
});

test("combo event queues preserve FIFO order, dedupe repeats, and skip only local state", () => {
  const first = { id: "a", sender: "one" };
  const second = { id: "b", sender: "two" };
  const third = { id: "c", sender: "one" };
  const viewerOne = appendUniqueGiftEvents([], [first, second, third, second]);
  const viewerTwo = [...viewerOne];
  assert.deepEqual(viewerOne.map(item => item.id), ["a", "b", "c"]);
  const afterSkip = finishGiftQueueItem(viewerOne, "a");
  assert.deepEqual(afterSkip.map(item => item.id), ["b", "c"]);
  assert.deepEqual(viewerTwo.map(item => item.id), ["a", "b", "c"], "skip does not mutate another viewer's queue");
  assert.equal(giftCounterAfterSkip(99), 99);
});

test("event queue has no fixed length cap", () => {
  const events = Array.from({ length: 1500 }, (_, index) => ({ id: `gift-${index}` }));
  assert.equal(appendUniqueGiftEvents([], events).length, 1500);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  isLiveStreamLeaseExpired,
  LIVE_STREAM_HEARTBEAT_TTL_MS,
  LIVE_STREAM_START_TTL_MS,
} from "./live-stream-session-policy";

test("starting stream leases expire after 30 seconds", () => {
  const startedAtMs = 1_000;
  assert.equal(isLiveStreamLeaseExpired({
    state: "starting", startedAtMs, lastHeartbeatAtMs: null,
    nowMs: startedAtMs + LIVE_STREAM_START_TTL_MS - 1,
  }), false);
  assert.equal(isLiveStreamLeaseExpired({
    state: "starting", startedAtMs, lastHeartbeatAtMs: null,
    nowMs: startedAtMs + LIVE_STREAM_START_TTL_MS,
  }), true);
});

test("live stream leases expire when the host heartbeat is 30 seconds old", () => {
  const lastHeartbeatAtMs = 5_000;
  assert.equal(isLiveStreamLeaseExpired({
    state: "live", startedAtMs: 0, lastHeartbeatAtMs,
    nowMs: lastHeartbeatAtMs + LIVE_STREAM_HEARTBEAT_TTL_MS - 1,
  }), false);
  assert.equal(isLiveStreamLeaseExpired({
    state: "live", startedAtMs: 0, lastHeartbeatAtMs,
    nowMs: lastHeartbeatAtMs + LIVE_STREAM_HEARTBEAT_TTL_MS,
  }), true);
});

test("ending leases are always expired and live leases without a heartbeat are stale", () => {
  assert.equal(isLiveStreamLeaseExpired({
    state: "ending", startedAtMs: 0, lastHeartbeatAtMs: 0, nowMs: 0,
  }), true);
  assert.equal(isLiveStreamLeaseExpired({
    state: "live", startedAtMs: 0, lastHeartbeatAtMs: null, nowMs: 0,
  }), true);
});

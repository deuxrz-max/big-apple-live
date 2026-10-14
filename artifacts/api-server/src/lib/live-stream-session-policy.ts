export const LIVE_STREAM_HEARTBEAT_INTERVAL_MS = 10_000;
export const LIVE_STREAM_HEARTBEAT_TTL_MS = 30_000;
export const LIVE_STREAM_START_TTL_MS = 30_000;

export function isLiveStreamLeaseExpired(input: {
  state: "starting" | "live" | "ending";
  startedAtMs: number;
  lastHeartbeatAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.state === "ending") return true;
  if (input.state === "starting") {
    return input.nowMs - input.startedAtMs >= LIVE_STREAM_START_TTL_MS;
  }
  return input.lastHeartbeatAtMs == null
    || input.nowMs - input.lastHeartbeatAtMs >= LIVE_STREAM_HEARTBEAT_TTL_MS;
}

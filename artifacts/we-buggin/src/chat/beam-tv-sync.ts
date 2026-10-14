export const BEAM_TV_SYNC_CHECK_MS = 8_000;
export const BEAM_TV_SYNC_CORRECTION_COOLDOWN_MS = 12_000;
export const BEAM_TV_SYNC_DRIFT_THRESHOLD_SECONDS = 3;
export const YOUTUBE_PLAYER_PLAYING_STATE = 1;

export function shouldCorrectBeamTvDrift(input: {
  driftSeconds: number;
  playerState: number;
  nowMs: number;
  lastCorrectionAtMs: number;
}): boolean {
  return input.playerState === YOUTUBE_PLAYER_PLAYING_STATE
    && Math.abs(input.driftSeconds) > BEAM_TV_SYNC_DRIFT_THRESHOLD_SECONDS
    && input.nowMs - input.lastCorrectionAtMs >= BEAM_TV_SYNC_CORRECTION_COOLDOWN_MS;
}

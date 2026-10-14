import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BEAM_TV_SYNC_CHECK_MS,
  BEAM_TV_SYNC_CORRECTION_COOLDOWN_MS,
  BEAM_TV_SYNC_DRIFT_THRESHOLD_SECONDS,
  shouldCorrectBeamTvDrift,
  YOUTUBE_PLAYER_PLAYING_STATE,
} from '../src/chat/beam-tv-sync';

test('small playback drift is left alone instead of seeking', () => {
  assert.equal(BEAM_TV_SYNC_DRIFT_THRESHOLD_SECONDS, 3);
  assert.equal(shouldCorrectBeamTvDrift({
    driftSeconds: 2.9,
    playerState: YOUTUBE_PLAYER_PLAYING_STATE,
    nowMs: 30_000,
    lastCorrectionAtMs: 0,
  }), false);
});

test('large drift corrects only during playback and after the cooldown', () => {
  const state = {
    driftSeconds: -4.5,
    playerState: YOUTUBE_PLAYER_PLAYING_STATE,
    nowMs: BEAM_TV_SYNC_CORRECTION_COOLDOWN_MS + 1,
    lastCorrectionAtMs: 0,
  };
  assert.equal(shouldCorrectBeamTvDrift({ ...state, playerState: 3 }), false);
  assert.equal(shouldCorrectBeamTvDrift({
    ...state,
    nowMs: BEAM_TV_SYNC_CORRECTION_COOLDOWN_MS - 1,
  }), false);
  assert.equal(shouldCorrectBeamTvDrift(state), true);
  assert.ok(BEAM_TV_SYNC_CHECK_MS >= 5_000);
});

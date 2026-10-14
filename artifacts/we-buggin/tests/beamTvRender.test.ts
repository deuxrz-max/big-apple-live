import assert from 'node:assert/strict';
import test from 'node:test';
import { beamTvPropsEqual } from '../src/chat/BeamTv';

const search = async () => ({ videoIds: [] }) as never;
const reportPlaybackFailure = async () => {};

function props(serverNowMs: number, currentVideoId = 'abc123xyz_1') {
  return {
    roomName: 'Music',
    search,
    reportPlaybackFailure,
    tv: {
      enabled: true,
      currentVideoId,
      playlistId: null,
      startedAtMs: 100_000,
      breakEndsAtMs: null,
      defaultSearch: 'Music',
      sourceType: 'search',
      sourceValue: 'Music',
      skipVotingEnabled: false,
      queue: [currentVideoId],
      serverNowMs,
      videoMetadata: [{
        videoId: currentVideoId,
        title: 'Music video',
        channelTitle: 'Artist',
        description: null,
      }],
    },
  } as unknown as Parameters<typeof beamTvPropsEqual>[0];
}

test('clock-only room polls do not rerender the YouTube player component', () => {
  assert.equal(beamTvPropsEqual(props(100_000), props(102_500)), true);
});

test('a changed video still updates the player component', () => {
  assert.equal(beamTvPropsEqual(props(100_000), props(102_500, 'newVideo1234')), false);
});

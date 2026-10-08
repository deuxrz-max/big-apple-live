/** Upload order, with the byte-identical second Project_08-20 upload removed. */
export const PROMO_VIDEOS = [
  { file: '01-immortal-studios.mp4', label: 'Immortal Studios promo' },
  { file: '02-moonlit-characters.mp4', label: 'Moonlit characters promo' },
  { file: '03-red-tunnel.mp4', label: 'Project 08-20 promo' },
  { file: '04-additional-project.mp4', label: 'Project 08-29 promo' },
] as const;

export type PlaylistState = { index: number; run: number; failed: number[]; stopped: boolean };
export type PlaylistEvent = { type: 'ended' | 'failed'; index: number; run: number };

export function initialPlaylistState(count: number): PlaylistState {
  return { index: 0, run: 0, failed: [], stopped: count === 0 };
}

/** Ignore stale/double callbacks from an old element; never skip two entries. */
export function advancePlaylist(state: PlaylistState, count: number, event: PlaylistEvent): PlaylistState {
  if (state.stopped || event.run !== state.run || event.index !== state.index) return state;
  const failed = event.type === 'failed' ? [...new Set([...state.failed, state.index])] : state.failed;
  for (let offset = 1; offset <= count; offset++) {
    const index = (state.index + offset) % count;
    if (!failed.includes(index)) return { index, run: state.run + 1, failed, stopped: false };
  }
  return { ...state, run: state.run + 1, failed, stopped: true };
}

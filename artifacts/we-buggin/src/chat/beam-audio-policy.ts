export type BeamMicSlot = {
  participantId: string | null;
  micMuted: boolean;
  mutedByHost: boolean;
};

export function isBeamMicEnabled(slot: BeamMicSlot | null | undefined): boolean {
  return Boolean(slot && !slot.micMuted && !slot.mutedByHost);
}

export function shouldSubscribeToBeamAudio(input: {
  listenerId: string;
  listenerMicEnabled: boolean;
  publisherId: string;
  slots: BeamMicSlot[];
}): boolean {
  if (!input.listenerMicEnabled || input.listenerId === input.publisherId) return false;
  const publisher = input.slots.find(slot => slot.participantId === input.publisherId);
  return isBeamMicEnabled(publisher);
}

export type BeamTvSoundPlayer = {
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
};

export function setBeamTvSoundMuted(player: BeamTvSoundPlayer, muted: boolean): void {
  if (muted) {
    player.mute();
    player.setVolume(0);
  } else {
    player.unMute();
    player.setVolume(100);
  }
}

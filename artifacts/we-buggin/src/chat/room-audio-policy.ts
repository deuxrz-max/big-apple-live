export type RoomMicSlot = {
  participantId: string | null;
  micMuted: boolean;
  mutedByHost: boolean;
};

export function isRoomMicEnabled(slot: RoomMicSlot | null | undefined): boolean {
  return Boolean(slot && !slot.micMuted && !slot.mutedByHost);
}

export function shouldSubscribeToRoomAudio(input: {
  listenerId: string;
  listenerMicEnabled: boolean;
  publisherId: string;
  slots: RoomMicSlot[];
}): boolean {
  if (!input.listenerMicEnabled || input.listenerId === input.publisherId) return false;
  const publisher = input.slots.find(slot => slot.participantId === input.publisherId);
  return isRoomMicEnabled(publisher);
}

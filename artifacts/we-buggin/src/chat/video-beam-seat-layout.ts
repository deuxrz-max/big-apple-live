export type VideoBeamSeat = {
  slotNumber: number;
  participantId: string | null;
};

export type VideoBeamSeatPlacement<T extends VideoBeamSeat = VideoBeamSeat> = {
  slot: T;
  area: "left" | "host" | "right";
  gridColumn: number;
  gridRow: number;
};

/** Keep one host seat centered and distribute the remaining seats four per side. */
export function arrangeVideoBeamSeats<T extends VideoBeamSeat>(
  slots: T[],
  hostParticipantId: string | null,
): VideoBeamSeatPlacement<T>[] {
  const ordered = [...slots].sort((left, right) => left.slotNumber - right.slotNumber);
  if (ordered.length !== 9) {
    throw new Error("The room beam must contain exactly nine speaker seats.");
  }

  const center = (hostParticipantId
    ? ordered.find(slot => slot.participantId === hostParticipantId)
    : undefined) ?? ordered[0]!;
  const guests = ordered.filter(slot => slot.slotNumber !== center.slotNumber);
  const placements = new Map<number, VideoBeamSeatPlacement<T>>([
    [center.slotNumber, { slot: center, area: "host", gridColumn: 3, gridRow: 1 }],
  ]);

  guests.forEach((slot, index) => {
    const onLeft = index < 4;
    const sideIndex = index % 4;
    placements.set(slot.slotNumber, {
      slot,
      area: onLeft ? "left" : "right",
      gridColumn: onLeft ? sideIndex % 2 + 1 : sideIndex % 2 + 4,
      gridRow: Math.floor(sideIndex / 2) + 1,
    });
  });

  return ordered.map(slot => placements.get(slot.slotNumber)!);
}

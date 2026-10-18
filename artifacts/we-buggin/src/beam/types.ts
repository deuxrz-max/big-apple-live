import type { PortraitId } from './portraits';
import type { MoodKey } from './moodCatalog';

export const CAPACITY = 12;
export const BEAM_CAPACITIES = [2, 4, 9, 12] as const;
export type BeamCapacity = typeof BEAM_CAPACITIES[number];
export const isBeamCapacity = (value: unknown): value is BeamCapacity => BEAM_CAPACITIES.some(size => size === value);
export const capacityColumns = (capacity: number) => capacity === 9 ? 3 : capacity === 12 ? 4 : 2;
export const MAX_MESSAGES = 60;

export type HairStyle = 'none' | 'spiked' | 'ponytails';

export interface Identity {
  /** Uploaded artwork is the displayed profile identity. */
  portraitId?: PortraitId;
  /** Persisted with the image; optional so old saved identities remain valid. */
  currentMood?: MoodKey;
  /** Selected expression, also retained for compatibility with old demo state. */
  emoji: string;
  style: HairStyle;
  hairColor: string;
}

export interface Participant {
  id: string;
  handle: string;
  displayNameColor?: string;
  displayNameTierIndex?: number;
  identity: Identity;
  simulated: boolean;
  joinedAt: number;
  /** Optional only for old isolated demo saves; shared snapshots always include these. */
  micEnabled?: boolean;
  hostMuted?: boolean;
  unmuteRequested?: boolean;
}

export type MessageKind = 'text' | 'reaction' | 'system';

export interface BeamMessage {
  id: string;
  kind: MessageKind;
  authorId: string | null;
  /** snapshot used if the author has left */
  authorSnapshot: { handle: string; identity: Identity; displayNameColor?: string; displayNameTierIndex?: number } | null;
  text: string;
  ts: number;
}

export interface BeamRoom {
  code: string;
  hostParticipantId?: string;
  name: string;
  capacity: BeamCapacity;
  participants: Participant[];
  messages: BeamMessage[];
  createdAt: number;
}

export interface Session {
  code: string;
  selfId: string;
}

export interface BeamState {
  version: 1;
  rooms: Record<string, BeamRoom>;
  session: Session | null;
}

export type BeamErrorCode =
  | 'INVALID_CODE'
  | 'NOT_FOUND'
  | 'ROOM_FULL'
  | 'INVALID_NAME'
  | 'INVALID_CAPACITY'
  | 'INVALID_HANDLE'
  | 'HANDLE_TAKEN'
  | 'NOT_MEMBER'
  | 'EMPTY_MESSAGE'
  | 'TOO_LONG';

export class BeamError extends Error {
  code: BeamErrorCode;
  constructor(code: BeamErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

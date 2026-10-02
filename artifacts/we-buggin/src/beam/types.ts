import type { PortraitId } from './portraits';

export const CAPACITY = 12;
export const MAX_MESSAGES = 60;

export type HairStyle = 'none' | 'spiked' | 'ponytails';

export interface Identity {
  /** Uploaded artwork is the displayed profile identity. */
  portraitId?: PortraitId;
  /** Retained only for compatibility with previously saved demo state. */
  emoji: string;
  style: HairStyle;
  hairColor: string;
}

export interface Participant {
  id: string;
  handle: string;
  identity: Identity;
  simulated: boolean;
  joinedAt: number;
}

export type MessageKind = 'text' | 'reaction' | 'system';

export interface BeamMessage {
  id: string;
  kind: MessageKind;
  authorId: string | null;
  /** snapshot used if the author has left */
  authorSnapshot: { handle: string; identity: Identity } | null;
  text: string;
  ts: number;
}

export interface BeamRoom {
  code: string;
  name: string;
  capacity: number;
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

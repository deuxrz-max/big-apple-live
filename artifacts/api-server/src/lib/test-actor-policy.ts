export type TestActorCommand =
  | { action: 'list' }
  | { action: 'join'; as: string; room: string }
  | { action: 'leave'; as: string; room: string }
  | { action: 'chat'; as: string; room: string; text: string }
  | { action: 'dm'; as: string; to: string; text: string };

const allowed: Record<TestActorCommand['action'], string[]> = {
  list: ['action'], join: ['action', 'as', 'room'], leave: ['action', 'as', 'room'],
  chat: ['action', 'as', 'room', 'text'], dm: ['action', 'as', 'to', 'text'],
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const username = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_]{3,24}$/.test(value.trim());
const room = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.trim().length <= 80;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.trim().length <= max;

export function parseTestActorCommand(value: unknown): TestActorCommand | null {
  if (!object(value) || typeof value.action !== 'string' || !Object.hasOwn(allowed, value.action)) return null;
  const action = value.action as TestActorCommand['action'];
  if (Object.keys(value).some(key => !allowed[action].includes(key))) return null;
  if (action === 'list') return { action };
  if (!username(value.as)) return null;
  if (action === 'join' || action === 'leave')
    return room(value.room) ? { action, as: value.as.trim(), room: value.room.trim() } : null;
  if (action === 'chat')
    return room(value.room) && text(value.text, 280)
      ? { action, as: value.as.trim(), room: value.room.trim(), text: value.text.trim() } : null;
  return username(value.to) && text(value.text, 1000)
    ? { action, as: value.as.trim(), to: value.to.trim(), text: value.text.trim() } : null;
}

export const TEST_ACTOR_OWNER_USERNAME = 'Vampsquad';
export const testActorControlEnabled = (nodeEnv: string | undefined) => nodeEnv === 'development';
export const mayReceiveTestDm = (target: { username: string; isTestAccount: boolean }) =>
  target.isTestAccount || target.username.toLowerCase() === TEST_ACTOR_OWNER_USERNAME.toLowerCase();

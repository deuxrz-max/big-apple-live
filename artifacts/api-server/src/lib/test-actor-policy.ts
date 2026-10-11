export type TestActorCommand =
  | { action: "list" }
  | { action: "join"; as: string; room: string }
  | { action: "leave"; as: string; room: string }
  | { action: "chat"; as: string; room: string; text: string }
  | { action: "dm"; as: string; to: string; text: string }
  | { action: "gift"; as: string; to: string; room: string; gift: "heart" | "spirit-pup" | "moonfox" | "cosmic-encore" };

const keys: Record<TestActorCommand["action"], string[]> = {
  list: ["action"],
  join: ["action", "as", "room"],
  leave: ["action", "as", "room"],
  chat: ["action", "as", "room", "text"],
  dm: ["action", "as", "to", "text"],
  gift: ["action", "as", "to", "room", "gift"],
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUsername = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_]{3,24}$/.test(value.trim());
const isRoom = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

export function parseTestActorCommand(value: unknown): TestActorCommand | null {
  if (!isObject(value) || typeof value.action !== "string"
    || !Object.prototype.hasOwnProperty.call(keys, value.action)) return null;
  const action = value.action as TestActorCommand["action"];
  if (Object.keys(value).some(key => !keys[action].includes(key))) return null;
  if (action === "list") return { action };
  if (!isUsername(value.as)) return null;
  if (action === "join" || action === "leave")
    return isRoom(value.room) ? { action, as: value.as.trim(), room: value.room.trim() } : null;
  if (action === "chat")
    return isRoom(value.room) && isText(value.text, 280)
      ? { action, as: value.as.trim(), room: value.room.trim(), text: value.text.trim() } : null;
  if (action === "dm")
    return isUsername(value.to) && isText(value.text, 1000)
      ? { action, as: value.as.trim(), to: value.to.trim(), text: value.text.trim() } : null;
  return isUsername(value.to) && isRoom(value.room)
    && (value.gift === "heart" || value.gift === "spirit-pup" || value.gift === "moonfox" || value.gift === "cosmic-encore")
    ? { action, as: value.as.trim(), to: value.to.trim(), room: value.room.trim(), gift: value.gift } : null;
}

export const TEST_ACTOR_OWNER_USERNAME = "Vampsquad";

export function testActorControlEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development";
}

export function mayReceiveTestDm(target: { username: string; isTestAccount: boolean }): boolean {
  return target.isTestAccount || target.username.toLowerCase() === TEST_ACTOR_OWNER_USERNAME.toLowerCase();
}

export function isTestGiftPair(senderIsTest: boolean, recipientIsTest: boolean): boolean {
  return senderIsTest && recipientIsTest;
}

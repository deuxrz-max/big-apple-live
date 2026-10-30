export type AccountRoomTitleResult =
  | { ok: true; name: string }
  | { ok: false; message: string };

/** Normalize a created-room title and reject any internal whitespace. */
export function normalizeAccountRoomTitle(value: string): AccountRoomTitleResult {
  const name = value.trim();
  if (!name) return { ok: false, message: "Enter a one-word room name. Ave is added automatically." };
  if (/\s/u.test(name)) return { ok: false, message: "Use a single word only; Ave is added automatically." };
  if (name.length > 32) return { ok: false, message: "Room names must be 32 characters or fewer." };
  return { ok: true, name };
}

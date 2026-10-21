export type LiveStreamEventKind = "message" | "gift";

/** Personal blocks filter text, but never suppress a person's room presence or gift effects. */
export function isLiveStreamEventVisible(
  kind: LiveStreamEventKind,
  username: string,
  blockedUsernames: ReadonlySet<string>,
): boolean {
  if (kind === "gift") return true;
  return !blockedUsernames.has(username.toLowerCase());
}

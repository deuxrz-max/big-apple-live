export const OWNER_ACCOUNT_USERNAMES = new Set(["vampsquad", "vampsquad4"]);

export function isOwnerAccount(profile: { username: string; isTestAccount: boolean }) {
  return !profile.isTestAccount && OWNER_ACCOUNT_USERNAMES.has(profile.username.trim().toLowerCase());
}

export function hasOwnerNameColorTestAccess(
  profile: { username: string; isTestAccount: boolean },
  nodeEnv = process.env.NODE_ENV,
) {
  return nodeEnv === "development" && isOwnerAccount(profile);
}

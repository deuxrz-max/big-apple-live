import { randomBytes } from "node:crypto";
import type { StreamerPassportLinkRow } from "@workspace/db";

export class PassportInputError extends Error {
  constructor(message: string) { super(message); this.name = "PassportInputError"; }
}

export const STREAMER_PASSPORT_PLATFORMS = [
  { id: "liveme", label: "LiveMe", color: "#FF5D85", domains: ["liveme.com"], makeUrl: (h: string) => `https://www.liveme.com/${encodeURIComponent(h)}` },
  { id: "tiktok", label: "TikTok", color: "#63D9E2", domains: ["tiktok.com"], makeUrl: (h: string) => `https://www.tiktok.com/@${encodeURIComponent(h)}` },
  { id: "bigo", label: "Bigo Live", color: "#45D1B5", domains: ["bigo.tv"], makeUrl: (h: string) => `https://www.bigo.tv/${encodeURIComponent(h)}` },
  { id: "instagram", label: "Instagram", color: "#D276E8", domains: ["instagram.com"], makeUrl: (h: string) => `https://www.instagram.com/${encodeURIComponent(h)}/` },
  { id: "facebook", label: "Facebook", color: "#7298FF", domains: ["facebook.com"], makeUrl: (h: string) => `https://www.facebook.com/${encodeURIComponent(h)}` },
  { id: "youtube", label: "YouTube", color: "#FF6262", domains: ["youtube.com"], makeUrl: (h: string) => `https://www.youtube.com/@${encodeURIComponent(h)}` },
  { id: "twitch", label: "Twitch", color: "#A780FF", domains: ["twitch.tv"], makeUrl: (h: string) => `https://www.twitch.tv/${encodeURIComponent(h)}` },
] as const;

export type PlatformId = typeof STREAMER_PASSPORT_PLATFORMS[number]["id"];
export type PassportBadgePlatform = { id: PlatformId; label: string; color: string };
export type PassportBadgeSummary = { platforms: PassportBadgePlatform[]; verified: boolean; foundingLeague: boolean };

export const passportPlatformFor = (raw: string) => STREAMER_PASSPORT_PLATFORMS.find(platform => platform.id === raw);

export function parsePlatformValue(platformId: string, rawValue: string) {
  const platform = passportPlatformFor(platformId);
  if (!platform) throw new PassportInputError("Choose one of the listed streaming platforms");
  const value = rawValue.trim();
  if (!value || value.length > 300 || /[\u0000-\u001f]/.test(value)) throw new PassportInputError("Enter a platform handle or profile link");
  let handle: string;
  let profileUrl: string;
  if (/^https?:\/\//i.test(value)) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new PassportInputError("Enter a valid public profile link"); }
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || !platform.domains.some(domain => domain === hostname) || parsed.search || parsed.hash || parsed.pathname === "/") {
      throw new PassportInputError(`Use an HTTPS ${platform.label} profile link`);
    }
    const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
    try { handle = decodeURIComponent(lastSegment).replace(/^@/, ""); }
    catch { throw new PassportInputError("That profile link is not valid"); }
    profileUrl = `https://${parsed.host}${parsed.pathname}`;
  } else {
    handle = value.replace(/^@/, "");
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(handle)) throw new PassportInputError("Use a platform handle or a valid HTTPS profile link");
    profileUrl = platform.makeUrl(handle);
  }
  if (!handle || handle.length > 120) throw new PassportInputError("Could not read a profile handle from that link");
  return { platform, handle, profileUrl };
}

export function verificationCode() {
  return `ST-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function privatePassportEntry(row: StreamerPassportLinkRow) {
  const platform = passportPlatformFor(row.platform);
  if (!platform) return null;
  return {
    id: platform.id, label: platform.label, color: platform.color, entryId: row.id,
    handle: row.handle, profileUrl: row.profileUrl, addedAt: row.addedAt.toISOString(),
    verificationCode: row.verificationCode, verificationStatus: row.verificationStatus,
    requestedAt: row.requestedAt?.toISOString() ?? null, verifiedAt: row.verifiedAt?.toISOString() ?? null,
  };
}

export function publicPassportEntry(row: StreamerPassportLinkRow) {
  const platform = passportPlatformFor(row.platform);
  if (!platform) return null;
  return {
    id: platform.id, label: platform.label, color: platform.color,
    handle: row.handle, profileUrl: row.profileUrl, addedAt: row.addedAt.toISOString(),
    verified: row.verificationStatus === "verified",
  };
}

export function reviewState(action: "approve" | "reject", moderatorId: string, now = new Date()) {
  return action === "approve"
    ? { verificationStatus: "verified" as const, verifiedAt: now, verifiedBy: moderatorId }
    : { verificationStatus: "unverified" as const, requestedAt: null, verifiedAt: null, verifiedBy: null };
}

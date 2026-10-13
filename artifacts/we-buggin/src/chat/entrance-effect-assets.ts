export type EntranceEffectAssetKind = "video" | "image" | "lottie";

export function isSupportedEntranceEffectContentType(
  kind: EntranceEffectAssetKind,
  contentType: string | null,
): boolean {
  const mime = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (kind === "lottie") return mime === "application/json" || mime.endsWith("+json");
  if (kind === "video") return mime === "video/mp4" || mime === "video/webm";
  return mime.startsWith("image/");
}

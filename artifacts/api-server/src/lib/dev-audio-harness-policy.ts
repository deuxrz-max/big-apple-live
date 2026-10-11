export const DEV_AUDIO_HARNESS_ROOM = {
  roomId: "DEV-AUDIO-LAB",
  historyId: "DEV-AUDIO-LAB-IN-MEMORY",
  label: "Preview Audio Test Lab",
} as const;

export const DEV_AUDIO_HARNESS_SESSION_TTL_MS = 90_000;

export function devAudioHarnessEnabled(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development";
}

export function mayDriveDevAudioAccount(profile: { isTestAccount?: boolean } | null | undefined): boolean {
  return profile?.isTestAccount === true;
}

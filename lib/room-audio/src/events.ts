import type { AudioEvent } from "./protocol";

/** fetch-based SSE supports Authorization headers; credentials never enter URLs. */
export async function readAudioEvents(
  response: Response,
  receive: (event: AudioEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("Signaling stream is unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = frame.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
        const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (type && data && ["audio.ready", "audio.peers", "audio.microphones", "audio.beam", "audio.signal", "audio.candidate", "audio.ended"].includes(type)) {
          receive({ type, data: JSON.parse(data) } as AudioEvent);
        }
      }
      if (buffer.length > 32_000) throw new Error("Invalid signaling frame");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
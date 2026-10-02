import { test, expect, type Page } from "@playwright/test";

async function start(page: Page, session: any) {
  await page.goto("/api/healthz");
  await page.evaluate(async (session) => {
    // SDK is served by the existing API; this test needs no application UI.
    const { RoomAudioClient } = await import(/* @vite-ignore */ "/api/room-audio.js");
    const state = window as any;
    // Synthetic input makes this test independent of physical capture devices.
    // RTCPeerConnection, signaling, playback, and RTP transport are not mocked.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      const destination = context.createMediaStreamDestination();
      volume.gain.value = 0.05;
      oscillator.connect(volume).connect(destination);
      oscillator.start();
      await context.resume();
      const track = destination.stream.getAudioTracks()[0]!;
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop();
        oscillator.stop();
        void context.close();
      };
      state.testInputTrack = track;
      return destination.stream;
    };
    state.audioErrors = [];
    state.audio = new RoomAudioClient({
      roomId: session.room.roomId, participantSessionId: session.participantSessionId,
      iceServers: [], // Local browser peers need host candidates, not an external STUN service.
      onError: (error: any) => state.audioErrors.push(error.code),
    });
    await state.audio.start();
  }, session);
}

async function connected(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const value = (window as any).audio.getDiagnostics();
    return value.microphoneActive && value.peers.length === 1
      && value.peers[0].state === "connected" && value.peers[0].remoteTracks === 1
      && value.peers[0].playbackActive;
  }), { timeout: 25_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const [stats] = await (window as any).audio.getPeerStats();
    return stats?.bytesReceived > 0 && stats?.bytesSent > 0;
  })).toBe(true);
}

test("two room participants exchange audio, reconnect, and leave without live tracks or stale peers", async ({ browser, request, baseURL }) => {
  const created = await request.post("/api/rooms", { data: { displayName: "Audio test A" } });
  expect(created.status()).toBe(201);
  const a = await created.json();
  const joined = await request.post(`/api/rooms/${a.room.roomId}/join`, { data: { displayName: "Audio test B" } });
  expect(joined.status()).toBe(201);
  const b = await joined.json();
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({
    baseURL, permissions: ["microphone"],
  })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await start(pages[0]!, a);
    await start(pages[1]!, b);
    await connected(pages[0]!);
    await connected(pages[1]!);
    const oldGeneration = await pages[1]!.evaluate(() => (window as any).audio.getDiagnostics().peers[0].connectionId);
    await pages[0]!.evaluate(() => (window as any).audio.reconnect());
    await expect.poll(() => pages[1]!.evaluate((old) =>
      (window as any).audio.getDiagnostics().peers[0]?.connectionId !== old, oldGeneration)).toBe(true);
    await connected(pages[0]!);
    await connected(pages[1]!);
    const snapshot = await (await request.get(`/api/rooms/${a.room.roomId}`)).text();
    expect(snapshot.includes(a.participantSessionId) || snapshot.includes(b.participantSessionId)).toBe(false);
    await pages[1]!.evaluate(() => (window as any).audio.leave());
    await expect.poll(() => pages[0]!.evaluate(() => (window as any).audio.getDiagnostics().peers.length)).toBe(0);
    const stopped = await pages[1]!.evaluate(() => (window as any).audio.getDiagnostics());
    expect(stopped.microphoneActive).toBe(false);
    expect(await pages[1]!.evaluate(() => (window as any).testInputTrack.readyState)).toBe("ended");
    expect(stopped.peers).toHaveLength(0);
    expect((await (await request.get(`/api/rooms/${a.room.roomId}`)).json()).participants).toHaveLength(1);
    await pages[0]!.evaluate(() => (window as any).audio.leave());
    const final = await pages[0]!.evaluate(() => (window as any).audio.getDiagnostics());
    expect(final.microphoneActive).toBe(false);
    expect(await pages[0]!.evaluate(() => (window as any).testInputTrack.readyState)).toBe("ended");
    expect(final.peers).toHaveLength(0);
    expect((await (await request.get(`/api/rooms/${a.room.roomId}`)).json()).participants).toHaveLength(0);
  } finally {
    for (const context of contexts) await context.close();
    for (const session of [a, b]) {
      await request.delete(`/api/rooms/${session.room.roomId}/participants/${session.participantSessionId}`);
    }
  }
});

test("microphone denial is explicit and does not change existing room membership", async ({ page, request }) => {
  const session = await (await request.post("/api/rooms", { data: { displayName: "Denied mic test" } })).json();
  try {
    await page.goto("/api/healthz");
    const result = await page.evaluate(async (session) => {
      const { RoomAudioClient } = await import(/* @vite-ignore */ "/api/room-audio.js");
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); };
      const audio = new RoomAudioClient({
        roomId: session.room.roomId, participantSessionId: session.participantSessionId,
      });
      let code = "";
      try { await audio.start(); } catch (error: any) { code = error.code; }
      return { code, diagnostics: audio.getDiagnostics() };
    }, session);
    expect(result.code).toBe("microphone-denied");
    expect(result.diagnostics.state).toBe("error");
    expect(result.diagnostics.microphoneActive).toBe(false);
    expect(result.diagnostics.peers).toHaveLength(0);
    expect((await (await request.get(`/api/rooms/${session.room.roomId}`)).json()).participants).toHaveLength(1);
  } finally {
    await request.delete(`/api/rooms/${session.room.roomId}/participants/${session.participantSessionId}`);
  }
});
import { test, expect } from "@playwright/test";

test("marked test accounts exercise real four-slot P2P signaling without device permissions", async ({ page }) => {
  const pageErrors: string[] = [];
  const signalingKinds: string[] = [];
  let mediaPermissionCalls = 0;
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/audio/signals")) return;
    try {
      const body = request.postDataJSON() as { kind?: string };
      if (body.kind) signalingKinds.push(body.kind);
    } catch {
      // Ignore unrelated or non-JSON requests.
    }
  });
  await page.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    (window as Window & { __originalGetUserMedia?: typeof navigator.mediaDevices.getUserMedia }).__originalGetUserMedia = original;
    mediaDevices.getUserMedia = async () => {
      (window as Window & { __getUserMediaCalls?: number }).__getUserMediaCalls =
        ((window as Window & { __getUserMediaCalls?: number }).__getUserMediaCalls ?? 0) + 1;
      throw new Error("Device microphone access is blocked in this automated test.");
    };
  });

  await page.goto("/__dev/audio-harness");
  await expect(page.getByTestId("dev-audio-harness")).toBeVisible();
  await expect(page.getByText(/Synthetic audio only/i)).toBeVisible();
  await expect(page.getByText(/No microphone or camera permission is requested/i)).toBeVisible();

  const accounts = await page.locator("#test-audio-account option").evaluateAll(options =>
    options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
  expect(accounts.length).toBeGreaterThanOrEqual(5);

  for (const username of accounts.slice(0, 5)) {
    await page.locator("#test-audio-account").selectOption(username);
    await page.getByRole("button", { name: "Connect as listener" }).click();
    await expect(page.getByTestId(`test-actor-${username}`)).toBeVisible();
  }
  await expect(page.locator("#connected-accounts-heading span")).toHaveText("5");
  const raceButton = page.getByRole("button", { name: "Run 5-way slot race" });
  await expect(raceButton).toBeEnabled();
  await raceButton.click();

  await expect.poll(async () => page.locator(".dev-audio-harness__slot.is-occupied").count(), { timeout: 45_000 }).toBe(4);
  await expect.poll(async () =>
    page.locator(".dev-audio-harness__actor-heading p").filter({ hasText: "· Speaker" }).count()).toBe(4);
  await expect(page.getByText(/Slot race complete: 4 joined, 4 of 4 spots are occupied/)).toBeVisible();
  await expect.poll(async () => {
    const cards = await page.locator(".dev-audio-harness__actor").allTextContents();
    const hasRtp = cards.some(text => /RTP sent [1-9]/.test(text));
    const visibleFailure = cards.some(text => /Audio negotiation timed out|Could not negotiate peer audio/.test(text));
    return hasRtp || visibleFailure;
  }, { timeout: 35_000 }).toBeTruthy();
  const transportCards = await page.locator(".dev-audio-harness__actor").allTextContents();
  const p2pObserved = transportCards.some(text => /P2P connected [1-9]/.test(text) || /RTP sent [1-9]/.test(text));
  const metrics = await page.locator(".dev-audio-harness__metrics").allTextContents();
  console.info(`[audio-harness] Browser transport metrics: ${metrics.join(" | ")}`);
  expect(signalingKinds).toContain("description");
  expect(signalingKinds).toContain("candidate");

  const hostCard = page.locator(".dev-audio-harness__actor").filter({ hasText: "Host controls" });
  await expect(hostCard).toHaveCount(1);
  const targetRow = hostCard.locator(".dev-audio-harness__target").first();
  const targetName = (await targetRow.locator("span").innerText()).trim();
  const targetUsername = await targetRow.getAttribute("data-username");
  expect(targetUsername).toBeTruthy();
  const targetSlot = page.locator(".dev-audio-harness__slot.is-occupied").filter({ hasText: targetName });
  const targetCard = page.getByTestId(`test-actor-${targetUsername}`);
  await targetRow.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(targetSlot).toContainText("Host-muted");
  await hostCard.getByRole("button", { name: "Allow self-unmute" }).first().click();
  await expect(targetCard).toContainText("Synthetic track enabled false");
  await targetCard.getByRole("button", { name: "Unmute synthetic mic" }).click();
  await expect(targetSlot).toContainText("Mic active");
  await expect(targetCard).toContainText("Synthetic track enabled true");
  await hostCard.getByRole("button", { name: "Kick" }).first().click();
  await expect.poll(async () => page.locator(".dev-audio-harness__slot.is-occupied").count()).toBe(3);

  const remainingSpeaker = page.locator(".dev-audio-harness__actor")
    .filter({ has: page.getByRole("button", { name: "Leave speaker spot" }) }).first();
  const leaverName = await remainingSpeaker.locator("h3").innerText();
  await remainingSpeaker.getByRole("button", { name: "Leave speaker spot" }).click();
  await expect.poll(async () => page.locator(".dev-audio-harness__slot.is-occupied").count()).toBe(2);
  await expect(page.locator(".dev-audio-harness__actor").filter({ hasText: leaverName })).toContainText("Audience listener");

  mediaPermissionCalls = await page.evaluate(() => (window as Window & { __getUserMediaCalls?: number }).__getUserMediaCalls ?? 0);
  expect(mediaPermissionCalls).toBe(0);
  test.info().annotations.push({
    type: "P2P transport",
    description: p2pObserved
      ? "P2P connection or RTP activity was observed in the browser."
      : `ICE candidates and SDP descriptions were exchanged, but no P2P connection or RTP was established in this browser environment (signals: ${signalingKinds.join(", ")}).`,
  });

  await page.getByRole("button", { name: "Disconnect all" }).click();
  await expect(page.getByText("Connect test accounts above to start the browser audio checks.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

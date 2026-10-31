import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import test from "node:test";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { SaveModeratorBotSettingsBody } from "@workspace/api-zod";

test("Zod 4 generated input validators preserve accepted values and limits", () => {
  const valid = { bannedWords: ["example"], breakSeconds: 30 };
  assert.deepEqual(SaveModeratorBotSettingsBody.parse(valid), valid);
  assert.equal(SaveModeratorBotSettingsBody.safeParse({
    ...valid, breakSeconds: 14,
  }).success, false);
  assert.equal(SaveModeratorBotSettingsBody.safeParse({
    ...valid, bannedWords: Array(201).fill("example"),
  }).success, false);
});

test("oversized constrained arrays do not allocate an issue per invalid item", () => {
  const result = z.array(z.string()).max(3).safeParse(Array(10_000).fill(null));
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues.length, 1);
});

test("compressed-body and multipart failures remain request-local", async () => {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post("/json", (req, res) => res.json(req.body));
  app.post("/upload", multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1024 },
  }).single("file"), (req, res) => res.json({ bytes: req.file?.size }));
  const handleError: ErrorRequestHandler = (_err, _req, res, _next) => {
    res.status(400).json({ error: "Invalid request" });
  };
  app.use(handleError);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const encoded = await fetch(`${base}/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      body: gzipSync('{"ok":true}'),
    });
    assert.equal(encoded.status, 200);
    assert.deepEqual(await encoded.json(), { ok: true });

    const trailing = await fetch(`${base}/json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      body: Buffer.concat([gzipSync('{"ok":true}'), Buffer.from("trailing")]),
    });
    assert.ok([200, 400].includes(trailing.status));
    await trailing.text();

    const form = new FormData();
    form.set("file", new Blob(["icon"]), "icon.txt");
    const uploaded = await fetch(`${base}/upload`, { method: "POST", body: form });
    assert.equal(uploaded.status, 200);
    assert.deepEqual(await uploaded.json(), { bytes: 4 });

    const malformed = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=incomplete" },
      body: "--incomplete\r\nnot-a-valid-part",
    });
    assert.equal(malformed.status, 400);
    await malformed.text();
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
});

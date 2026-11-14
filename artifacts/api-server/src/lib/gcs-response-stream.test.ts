import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { streamGcsObject } from "./gcs-response-stream";

async function withServer<T>(
  handler: RequestListener,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
}

test("GCS response stream sends a normal response", async () => {
  await withServer((_req, res) => {
    streamGcsObject(Readable.from([Buffer.from("media-icon")]), res, "test icon");
  }, async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "media-icon");
  });
});

test("a client abort drains the source and leaves the server available", async () => {
  let resolveDrained!: () => void;
  const drained = new Promise<void>((resolve) => { resolveDrained = resolve; });

  await withServer((req, res) => {
    if (req.url === "/health") {
      res.end("healthy");
      return;
    }
    const source = Readable.from((async function* () {
      for (let i = 0; i < 40; i += 1) {
        await delay(3);
        yield Buffer.alloc(32 * 1024, i);
      }
    })());
    source.once("end", resolveDrained);
    streamGcsObject(source, res, "test animation");
  }, async (baseUrl) => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/stream`, { signal: controller.signal });
    controller.abort();
    await Promise.race([
      drained,
      delay(3000).then(() => { throw new Error("GCS source was not drained after client abort"); }),
    ]);

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "healthy");
    await response.body?.cancel().catch(() => undefined);
  });
});

test("a storage stream error becomes a logged request-level 503", async () => {
  await withServer((req, res) => {
    if (req.url === "/health") {
      res.end("healthy");
      return;
    }
    res.setHeader("Content-Length", "1024");
    const source = new Readable({
      read() {
        this.destroy(new Error("synthetic storage failure"));
      },
    });
    streamGcsObject(source, res, "test photo", 503);
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/storage`);
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "");

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), "healthy");
  });
});

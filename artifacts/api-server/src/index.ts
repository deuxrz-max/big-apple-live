import app from "./app";
import { logger } from "./lib/logger";
import { roomStore } from "./lib/room-store";
import { createServer } from "node:http";
import { attachRoomMoodSocket } from "./lib/room-mood-socket";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const presenceSweep = setInterval(() => roomStore.sweep(), 5_000);
presenceSweep.unref();

const server = createServer(app);
attachRoomMoodSocket(server);
server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
server.on('error', err => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

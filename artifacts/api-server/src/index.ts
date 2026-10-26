import app from "./app";
import { logger } from "./lib/logger";
import { roomStore } from "./lib/room-store";
import { createServer } from "node:http";
import { initializeCommunities } from "./lib/community";
import { startPhotoRetentionScheduler } from "./lib/profile-photo-retention";
import { initializeModeratorBots, startModeratorBotChatter, startModeratorBotRotation } from "./lib/moderator-bots";
import { startTestActorControl } from "./lib/test-actor-control";
import {
  startComedyTvPlaybackScheduler,
  startCommunityRoomPlaybackScheduler,
  startWebSeriesDailySelection,
} from "./routes/university-video-beam";
import { sanitizeAllSavedCommunityVideoPools } from "./lib/room-video-rotation";
import { startCommunityVideoPoolRefillScheduler } from "./lib/community-video-pool-refill";
import { startDeveloperContentSyncScheduler } from "./lib/developer-content-sync";
import { startHangoutRewardScheduler } from "./lib/community-hangout-rewards";
import { startPinkRewardScheduler } from "./lib/pink-card-rewards";

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
await initializeCommunities();
try {
  const report = await sanitizeAllSavedCommunityVideoPools(roomStore);
  logger.info(report, "Saved community video pools screened for English, landscape, non-Shorts playback");
} catch (error) {
  logger.error({ error }, "Saved community video pool screening failed; per-room screening remains enabled");
}
startWebSeriesDailySelection();
startComedyTvPlaybackScheduler();
startCommunityRoomPlaybackScheduler();
startCommunityVideoPoolRefillScheduler(roomStore);
startDeveloperContentSyncScheduler();
await startHangoutRewardScheduler();
startPinkRewardScheduler();
await initializeModeratorBots();
startModeratorBotRotation((err, context) => logger.error({ err, ...context }, "Bot rotation failed"));
startModeratorBotChatter((err, context) => logger.error({ err, ...context }, "Bot chatter failed"));
startPhotoRetentionScheduler();
await startTestActorControl();
server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
server.on('error', err => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

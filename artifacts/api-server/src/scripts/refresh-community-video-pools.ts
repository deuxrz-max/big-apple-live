import { initializeCommunities } from "../lib/community";
import { refillNextCommunityVideoPoolOnce } from "../lib/community-video-pool-refill";
import { roomStore } from "../lib/room-store";

if (process.env.NODE_ENV === "production") {
  throw new Error("Community video pool refills are disabled in production.");
}

await initializeCommunities();
const result = await refillNextCommunityVideoPoolOnce(roomStore);
if (result) {
  console.info(`Refilled one room pool: ${result.roomId} now has ${result.count} verified playable videos.`);
} else {
  console.info("No room pool was refilled: the YouTube key or preview quota budget is unavailable.");
}

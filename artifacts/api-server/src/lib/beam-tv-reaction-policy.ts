import type { UniversityVideoBeamTvVideoMetadata } from "@workspace/api-zod";
import type { BotId } from "./bot-policy";

const beamTvTopicTerms = [
  "trailer", "gameplay", "highlights", "concert", "festival", "music video", "interview",
  "review", "recap", "stand-up", "comedy", "tour", "performance", "behind the scenes",
];

function cleanVideoMetadataText(value: string | null | undefined, max: number) {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/["“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function beamTvReactionLine(
  botId: BotId,
  metadata: UniversityVideoBeamTvVideoMetadata | null,
) {
  const title = cleanVideoMetadataText(metadata?.title, 80).split(" ").slice(0, 7).join(" ");
  const channel = cleanVideoMetadataText(metadata?.channelTitle, 48).split(" ").slice(0, 3).join(" ");
  const description = cleanVideoMetadataText(metadata?.description, 500).toLocaleLowerCase("en-US");
  const knownText = `${title} ${description}`.toLocaleLowerCase("en-US");
  const topic = beamTvTopicTerms.find(term => knownText.includes(term));
  const titleRef = title ? `“${title}”` : "this video";
  switch (botId) {
    case "ghost":
      return `${titleRef} is up—anyone seen this one?`;
    case "vampire":
      return `A ${topic ?? "new video"}${channel ? ` from ${channel}` : ""} after dark. Worth a watch?`;
    case "wolf":
      return topic
        ? `The video details mention ${topic}; what do you think, pack?`
        : `What do you think of ${titleRef}, pack?`;
    case "zombie":
      return title
        ? `I'm awake for ${titleRef}—has anyone watched it?`
        : "New video is up—anyone recognize it?";
  }
}

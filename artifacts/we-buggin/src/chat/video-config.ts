export type Scene = "city" | "calm" | "volcano";
/** Every university uses the same approved summer clip, regardless of activity.
 * Room state remains independent; it does not select seasonal video assets.
 * A six-second asset naturally loops; loop endings never change room state. */
const summerVideo = `${import.meta.env.BASE_URL}atmospheres/summer.mp4`;
export const roomVideoMapping: Record<Scene, { src: string; label: string }> = {
  city: { src: summerVideo, label: "Sunlit forest" },
  calm: { src: summerVideo, label: "Sunlit forest" },
  volcano: { src: summerVideo, label: "Sunlit forest" },
};

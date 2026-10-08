export type Scene = "city" | "calm" | "volcano";
/** Calm forest clip supplied by the user; other scenes remain placeholders.
 * Configure only approved, optimized local/App Storage
 * URLs. A six-second asset naturally loops; loop endings never change scenes. */
export const roomVideoMapping: Record<Scene, { src: string | null; label: string; poster?: string }> = {
  city: { src: null, label: "Busy city street" },
  calm: {
    src: `${import.meta.env.BASE_URL}atmospheres/summer.mp4`,
    poster: `${import.meta.env.BASE_URL}atmospheres/calm-forest.jpg`,
    label: "Sunlit forest",
  },
  volcano: { src: null, label: "Volcano — tone switching disabled" },
};

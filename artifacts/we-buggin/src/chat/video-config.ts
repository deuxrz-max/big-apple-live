export type Scene = "city" | "calm" | "volcano";
/** No final clips supplied. Configure only licensed, optimized local/App Storage
 * URLs. A six-second asset naturally loops; loop endings never change scenes. */
export const roomVideoMapping: Record<Scene, { src: string | null; label: string }> = {
  city: { src: null, label: "Busy city street" },
  calm: { src: null, label: "Quiet cafe" },
  volcano: { src: null, label: "Volcano — tone switching disabled" },
};

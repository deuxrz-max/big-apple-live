import { useSyncExternalStore } from "react";
import type { ModelLoadStatus } from "./SceneBackdrop";

type LoadStatuses = Record<string, ModelLoadStatus>;

let snapshot: LoadStatuses = {};
const listeners = new Set<() => void>();

export function reportSceneModelLoad(status: ModelLoadStatus) {
  const next = { ...snapshot };
  if (status.status === "loaded" || status.status === "error") next[status.id] = status;
  else next[status.id] = status;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function useSceneModelLoadStatuses() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const sceneSettings = {
  postProcessing: {
    bloom: 0.15,
    depthOfField: 0.15,
    ambientOcclusion: 0.15,
  },
  quality: {
    maxDpr: 1.5,
    lowEndDpr: 0.85,
    lowEndParticleCount: 72,
    particleCount: 180,
    lowEndObjectCount: 3,
    objectCount: 7,
    maxModels: 8,
  },
  camera: {
    minDistance: 8,
    maxDistance: 15,
    initialDistance: 11.5,
    minAzimuth: -0.55,
    maxAzimuth: 0.55,
    minPolar: 1.12,
    maxPolar: 2.02,
    damping: 0.065,
  },
  motion: {
    lightSpeed: 0.22,
    floatSpeed: 0.16,
    pointerInfluence: 0.14,
  },
} as const;

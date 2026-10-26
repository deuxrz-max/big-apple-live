import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { accountProfiles, db } from "@workspace/db";
import type { DeveloperGiftMotionPreset } from "@workspace/api-zod";
import { GetGifterLeaderboardResponse } from "@workspace/api-zod";
import { gifterLeaderboard } from "../lib/social/gifter-leaderboard";
import {
  SaveSocialProfileBody, SaveSocialProfileResponse, GetSocialMeResponse, GetSocialPeopleResponse,
  UpdateMyEntranceEffectSettingsBody, UpdateMyEntranceEffectSettingsResponse,
  GetSocialPersonResponse, SetSocialRelationshipBody, SendSocialGiftBody, PurchaseSocialProductBody,
  SendSocialMessageBody, SendSocialMessageResponse, GetSocialConversationResponse, GetSocialInboxResponse,
  GetSocialLedgerResponse, GetSocialPeopleQueryParams, GetSocialConversationQueryParams,
  SetMyNameColorTestTotalBody, SetMyNameColorTestTotalResponse,
  GetFavoritesGalleryResponse, GetFavoriteRoomResponse,
  EquipMyBadgeBody, EquipMyBadgeResponse,
  CreateGiftStudioVersionBody, CreateGiftStudioVersionResponse,
  SaveGiftStudioProcessedBody,
  GetGiftStudioLibraryResponse, SetGiftStudioVersionActiveBody, SetGiftStudioVersionActiveParams,
  SetGiftStudioVersionActiveResponse, AssignGiftStudioVersionToGiftBody, AssignGiftStudioVersionToGiftParams,
  AssignGiftStudioVersionToGiftResponse, GetGiftStudioVersionMediaParams,
  UpdateGiftStudioCatalogItemBody, UpdateGiftStudioCatalogItemParams, UpdateGiftStudioCatalogItemResponse,
  GetActiveGiftStudioMediaParams, GetActiveGiftStudioMediaResponse,
  GetAdminGiftMotionsResponse, UploadGiftMotionBody, UploadGiftMotionResponse,
  DeleteGiftMotionParams, DeleteGiftMotionResponse,
  GetGiftMotionPlaybackParams, GetGiftMotionPlaybackResponse,
  GetDeveloperContentSyncResponse, RunDeveloperContentSyncResponse,
  GetHangoutRewardSettingsResponse, SetHangoutRewardIntervalBody,
  SetHangoutRewardIntervalResponse,
} from "@workspace/api-zod";
import { accountId, sameOrigin } from "./identity";
import { RoomError, roomStore } from "../lib/room-store";
import { requireAccount } from "../lib/social/core";
import { CAULDRON_VERSION_ID } from "../lib/system-cauldron-assets";
import { nameColorProfileForAccount, setNameColorPurchaseTotalOverride } from "../lib/social/gift-name-color-data";
import { accessFor, requireAdult, requireOwner } from "../lib/community";
import { blocks, getMe, getPerson, listPeople, relationship, saveSocialProfile } from "../lib/social/people";
import { claimDaily, gift, ledger, purchase, serializeGiftSends } from "../lib/social/rewards";
import { roomGiftEvents } from '../lib/social/room-gifts';
import {
  serveGiftMedia, serveMoonfoxGiftMedia, serveCosmicEncoreGiftMedia,
  serveFireworksGiftMedia, serveRoseShowerGiftMedia, serveWhipGiftMedia,
} from '../lib/gift-media';
import { serveMonthlyCreditTierEntranceEffectMedia, serveRoomEntranceEffectMedia } from "../lib/room-entry-effect-media";
import { clearThread, inbox, sendMessage, thread } from "../lib/social/messages";
import { favoritesGallery, favoriteRoom } from "../lib/social/favorites";
import { requireLiveStreamGiftAccess } from "../lib/live-stream-policy";
import { getDeveloperContentSyncStatus, runDeveloperContentSync } from "../lib/developer-content-sync";
import { getHangoutRewardSettings, setHangoutRewardInterval } from "../lib/community-hangout-rewards";
import { liveStreamChatHub } from "../lib/live-stream-chat";
import { getMyEntranceEffectSettings, saveMyEntranceEffectSettings } from "../lib/social/entrance-effect-preferences";
import { equipEntranceEffect, listEntranceEffectShop, purchaseEntranceEffect } from "../lib/social/entrance-effect-shop";
import { saveEquippedBadge } from "../lib/social/monthly-credit-badges";
import {
  createGiftStudioVersion, deleteGiftStudioVersion, getActiveGiftStudioMedia, giftStudioMediaFile,
  giftStudioIconFile, overrideGiftStudioIcon, regenerateGiftStudioIcon,
  listGiftStudioVersions, processGiftStudioClipOnServer, renameGiftStudioVersion,
  setGiftStudioVersionActive, assignGiftStudioVersionToGift, updateGiftCatalogItem,
} from "../lib/gift-studio";
import {
  claimGiftStudioProcessingSession, discardGiftStudioProcessingSession,
  releaseGiftStudioProcessingSession, retainGiftStudioProcessingSession,
} from "../lib/gift-studio-processing-sessions";
import {
  addGiftMotion, deleteOwnerGiftMotion, getActiveGiftMotion, getActiveGiftMotionFile,
  listOwnerGiftMotions,
} from "../lib/developer-gift-motions";
import { inspectGiftMotionModelFile } from "../lib/gift-motion-model-file";

const router: IRouter = Router();
router.get('/gift-media/spirit-pup/v1/:filename', serveGiftMedia);
router.get('/gift-media/moonfox/v1/:filename', serveMoonfoxGiftMedia);
router.get('/gift-media/cosmic-encore/v2/:filename', serveCosmicEncoreGiftMedia);
router.get('/gift-media/fireworks/v3/:filename', serveFireworksGiftMedia);
router.get('/gift-media/rose-shower/v3/:filename', serveRoseShowerGiftMedia);
router.get('/gift-media/whip/v3/:filename', serveWhipGiftMedia);
router.get('/room-entry-effects/lion/:filename', serveRoomEntranceEffectMedia);
router.get('/room-entry-effects/monthly-credit-tiers/:tier/:filename', serveMonthlyCreditTierEntranceEffectMedia);
// A fixed decorative homepage asset, like the public built-in gift media above.
// No arbitrary version ID, source file or Overflow media can be requested here.
router.get("/gift-media/system-cauldron/:variant", async (req, res): Promise<void> => {
  const variant = req.params.variant;
  if (variant !== "webm" && variant !== "safari") throw new RoomError(404, "Media not found.");
  await streamStudioMedia(req, res, { versionId: CAULDRON_VERSION_ID, variant, activeOnly: true });
});
router.use("/social", async (req, res, next) => {
  const id = accountId(req);
  if (req.method !== "GET") sameOrigin(req);
  await requireAccount(id);
  res.set("Cache-Control", "no-store");
  next();
});

const studioTempDirs = new WeakMap<Request, string>();
const giftMotionTempDirs = new WeakMap<Request, string>();
const studioUpload = multer({
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      let directory = studioTempDirs.get(req);
      if (!directory) {
        directory = path.join(tmpdir(), `streamtalk-gift-studio-${randomUUID()}`);
        studioTempDirs.set(req, directory);
        mkdir(directory, { recursive: true }).then(
          () => callback(null, directory!),
          (error: Error) => callback(error, ""),
        );
        return;
      }
      callback(null, directory);
    },
    filename(_req, _file, callback) {
      callback(null, randomUUID());
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 2, fields: 4, fieldSize: 8192, parts: 6 },
}).fields([
  { name: "sourceVideo", maxCount: 1 },
  { name: "processedWebm", maxCount: 1 },
]);

async function ownerOnly(req: Request, _res: Response, next: (error?: unknown) => void) {
  try {
    await requireOwner(accountId(req));
    next();
  } catch (error) {
    next(error);
  }
}

const giftMotionUpload = multer({
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      let directory = giftMotionTempDirs.get(req);
      if (!directory) {
        directory = path.join(tmpdir(), `streamtalk-gift-motion-${randomUUID()}`);
        giftMotionTempDirs.set(req, directory);
        mkdir(directory, { recursive: true }).then(
          () => callback(null, directory!),
          (error: Error) => callback(error, ""),
        );
        return;
      }
      callback(null, directory);
    },
    filename(_req, _file, callback) {
      callback(null, randomUUID());
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 5, fieldSize: 32 * 1024, parts: 6 },
});
const giftIconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single("icon");
const uploadGiftMotionFile = giftMotionUpload.single("model");

function parseGiftMotionUpload(req: Request, res: Response, next: (error?: unknown) => void) {
  uploadGiftMotionFile(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const directory = giftMotionTempDirs.get(req);
    if (directory) void rm(directory, { recursive: true, force: true }).finally(() => giftMotionTempDirs.delete(req));
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new RoomError(413, "Choose a GLB or GLTF model no larger than 100 MB."));
      return;
    }
    next(new RoomError(400, "Choose one GLB or GLTF model file."));
  });
}

function parseGiftMotionPreset(value: unknown): DeveloperGiftMotionPreset | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const categoryValid = ["vehicle", "character", "object", "logo"].includes(String(item.category));
  const validDirection = (candidate: unknown) => ["left", "right", "top", "bottom", "depth"].includes(String(candidate));
  const bounded = (candidate: unknown, min: number, max: number) =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min && candidate <= max;
  if (item.version !== 1 || item.durationMs !== 6000 || !categoryValid
    || !validDirection(item.entry) || !validDirection(item.exit)) return null;
  if (!bounded(item.speed, 0.5, 1.5) || !Array.isArray(item.spin) || item.spin.length !== 3
    || item.spin.some((axis) => !bounded(axis, -6.3, 6.3))) return null;
  if (!bounded(item.drift, 0, 1) || !bounded(item.bounce, 0, 1)
    || !bounded(item.cameraYaw, -1.2, 1.2) || !bounded(item.cameraPitch, -0.8, 0.8)) return null;
  if (item.animationIndex !== null
    && (!Number.isInteger(item.animationIndex) || !bounded(item.animationIndex, 0, 100))) return null;
  return value as DeveloperGiftMotionPreset;
}

function parseStudioUpload(req: Request, res: Response, next: (error?: unknown) => void) {
  studioUpload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const directory = studioTempDirs.get(req);
    if (directory) void rm(directory, { recursive: true, force: true }).finally(() => studioTempDirs.delete(req));
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new RoomError(413, "Each video must be 100 MB or smaller."));
      return;
    }
    next(new RoomError(400, "Choose a valid video file. Each file must be 100 MB or smaller."));
  });
}

function parseGiftIconUpload(req: Request, res: Response, next: (error?: unknown) => void) {
  giftIconUpload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      next(new RoomError(413, "Choose a PNG icon no larger than 5 MB."));
      return;
    }
    next(new RoomError(400, "Choose one PNG icon image."));
  });
}

async function streamStudioMedia(
  req: Request,
  res: Response,
  input: { versionId: string; variant: "original" | "webm" | "safari"; ownerId?: string; activeOnly?: boolean },
): Promise<void> {
  const { file, contentType, immutable } = await giftStudioMediaFile(input);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw new RoomError(404, "Gift media not found.");
  res.set({
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "private, no-store",
  });
  let start = 0;
  let end = size - 1;
  const range = req.get("Range");
  if (range) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parsed || (!parsed[1] && !parsed[2])) {
      res.set("Content-Range", `bytes */${size}`).status(416).end();
      return;
    }
    start = parsed[1] ? Number(parsed[1]) : Math.max(0, size - Number(parsed[2]));
    end = parsed[1] && parsed[2] ? Math.min(size - 1, Number(parsed[2])) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.set("Content-Range", `bytes */${size}`).status(416).end();
      return;
    }
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.set("Content-Length", String(end - start + 1));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const source = file.createReadStream({ start, end });
  res.on("close", () => source.destroy());
  source.on("error", () => res.destroy()).pipe(res);
}

async function streamStudioIcon(req: Request, res: Response, versionId: string): Promise<void> {
  const { file } = await giftStudioIconFile({ versionId, activeOnly: true });
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0) throw new RoomError(404, "Gift icon not found.");
  res.set({
    "Content-Type": "image/png",
    "Content-Length": String(size),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const source = file.createReadStream();
  res.on("close", () => source.destroy());
  source.on("error", () => res.destroy()).pipe(res);
}

router.get("/social/admin/gift-studio/library", ownerOnly, async (req, res): Promise<void> => {
  res.json(GetGiftStudioLibraryResponse.parse(await listGiftStudioVersions(accountId(req))));
});

router.get("/social/admin/content-sync", ownerOnly, async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(GetDeveloperContentSyncResponse.parse(await getDeveloperContentSyncStatus()));
});

router.post("/social/admin/content-sync/run", ownerOnly, async (req, res): Promise<void> => {
  sameOrigin(req);
  res.set("Cache-Control", "no-store");
  res.json(RunDeveloperContentSyncResponse.parse(await runDeveloperContentSync("manual")));
});

router.get("/social/admin/hangout-rewards", ownerOnly, async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(GetHangoutRewardSettingsResponse.parse(await getHangoutRewardSettings()));
});

router.patch("/social/admin/hangout-rewards", ownerOnly, async (req, res): Promise<void> => {
  const input = SetHangoutRewardIntervalBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Choose an average interval from 15 to 360 minutes." });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(SetHangoutRewardIntervalResponse.parse(
    await setHangoutRewardInterval(input.data.averageIntervalMinutes),
  ));
});

router.get("/social/admin/gift-motions", ownerOnly, async (req, res): Promise<void> => {
  res.json(GetAdminGiftMotionsResponse.parse({ motions: await listOwnerGiftMotions(accountId(req)) }));
});

router.post("/social/admin/gift-motions", ownerOnly, parseGiftMotionUpload, async (req, res): Promise<void> => {
  const directory = giftMotionTempDirs.get(req);
  try {
    const file = req.file;
    if (!directory || !file) throw new RoomError(400, "Choose one GLB or GLTF model file.");
    const fields = UploadGiftMotionBody.safeParse({
      name: req.body?.name,
      cost: Number(req.body?.cost),
      category: req.body?.category,
      animationNames: req.body?.animationNames,
      motion: req.body?.motion,
      model: file.originalname,
    });
    if (!fields.success) throw new RoomError(400, "Check the gift name, coin price and motion settings.");
    let animationNames: unknown;
    let motionValue: unknown;
    try {
      animationNames = JSON.parse(fields.data.animationNames);
      motionValue = JSON.parse(fields.data.motion);
    } catch {
      throw new RoomError(400, "The model animation or motion data is invalid.");
    }
    if (!Array.isArray(animationNames) || animationNames.length > 100
      || animationNames.some((name) => typeof name !== "string" || name.length > 120)) {
      throw new RoomError(400, "The model's animation list is invalid.");
    }
    const motion = parseGiftMotionPreset(motionValue);
    if (!motion || motion.category !== fields.data.category) {
      throw new RoomError(400, "The selected motion does not match the model category.");
    }
    if (motion.animationIndex !== null && motion.animationIndex >= animationNames.length) {
      throw new RoomError(400, "Choose an animation included in this model.");
    }
    const checked = await inspectGiftMotionModelFile(file.path, file.originalname);
    const result = await addGiftMotion({
      ownerId: accountId(req),
      name: fields.data.name.trim(),
      cost: fields.data.cost,
      originalName: file.originalname,
      filePath: file.path,
      category: fields.data.category,
      animationNames: animationNames as string[],
      motion,
      checked,
    });
    res.status(201).json(UploadGiftMotionResponse.parse(result));
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      giftMotionTempDirs.delete(req);
    }
  }
});

router.delete("/social/admin/gift-motions/:giftId", ownerOnly, async (req, res): Promise<void> => {
  const params = DeleteGiftMotionParams.safeParse(req.params);
  if (!params.success) throw new RoomError(400, "Choose a valid saved 3D gift.");
  const deleted = await deleteOwnerGiftMotion(accountId(req), params.data.giftId);
  if (!deleted) throw new RoomError(404, "Saved 3D gift not found.");
  res.json(DeleteGiftMotionResponse.parse({ ok: true }));
});

router.get("/social/gift-motions/:giftId", async (req, res): Promise<void> => {
  const params = GetGiftMotionPlaybackParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "3D gift motion is unavailable.");
  const motion = await getActiveGiftMotion(params.data.giftId);
  if (!motion) throw new RoomError(404, "3D gift motion is unavailable.");
  res.json(GetGiftMotionPlaybackResponse.parse(motion));
});

router.get("/social/gift-motions/:giftId/file", async (req, res): Promise<void> => {
  const params = GetGiftMotionPlaybackParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "3D gift model is unavailable.");
  const model = await getActiveGiftMotionFile(params.data.giftId);
  if (!model) throw new RoomError(404, "3D gift model is unavailable.");
  res.set({
    "Content-Type": model.contentType,
    "Content-Length": String(model.byteSize),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  const stream = model.file.createReadStream();
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy()).pipe(res);
});

router.patch("/social/admin/gift-studio/catalog/:giftId", ownerOnly, async (req, res): Promise<void> => {
  const params = UpdateGiftStudioCatalogItemParams.safeParse(req.params);
  const body = UpdateGiftStudioCatalogItemBody.safeParse(req.body);
  if (!params.success || !body.success || Object.keys(body.data).length === 0) {
    throw new RoomError(400, "Choose a gift name, whole positive coin price, or availability.");
  }
  const result = await updateGiftCatalogItem({ giftId: params.data.giftId, ...body.data });
  res.json(UpdateGiftStudioCatalogItemResponse.parse(result));
});

router.post("/social/admin/gift-studio/catalog/:giftId/icon", ownerOnly, async (req, res): Promise<void> => {
  const result = await regenerateGiftStudioIcon(accountId(req), String(req.params.giftId ?? ""));
  res.set("Cache-Control", "no-store").json(result);
});

router.put("/social/admin/gift-studio/catalog/:giftId/icon", ownerOnly, parseGiftIconUpload, async (req, res): Promise<void> => {
  if (!req.file?.buffer) throw new RoomError(400, "Choose a PNG icon image.");
  const result = await overrideGiftStudioIcon(accountId(req), String(req.params.giftId ?? ""), req.file.buffer);
  res.set("Cache-Control", "no-store").json(result);
});

router.get("/social/gift-studio/icons/:versionId", async (req, res): Promise<void> => {
  const versionId = typeof req.params.versionId === "string" ? req.params.versionId : "";
  await streamStudioIcon(req, res, versionId);
});

router.post("/social/admin/gift-studio/process", ownerOnly, parseStudioUpload, async (req, res): Promise<void> => {
  const directory = studioTempDirs.get(req);
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const source = files?.sourceVideo?.[0];
  const controller = new AbortController();
  let retainedForSave = false;
  req.once("aborted", () => controller.abort());
  res.once("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    if (!directory || !source) throw new RoomError(400, "Choose a source video before processing.");
    let settingsValue: unknown;
    try {
      settingsValue = JSON.parse(String(req.body?.settings ?? ""));
    } catch {
      throw new RoomError(400, "The key settings could not be read. Refresh the page and try again.");
    }
    const settings = CreateGiftStudioVersionResponse.shape.settings.parse(settingsValue);
    const result = await processGiftStudioClipOnServer({
      sourcePath: source.path,
      sourceBytes: source.size,
      sourceName: source.originalname,
      settings,
      signal: controller.signal,
    });
    const bytes = await readFile(result.path);
    const processingSession = retainGiftStudioProcessingSession({
      ownerId: accountId(req),
      directory,
      sourcePath: source.path,
      sourceName: source.originalname,
      sourceBytes: source.size,
      processedPath: result.path,
      processedBytes: result.bytes,
      settings,
    });
    retainedForSave = true;
    res.set({
      "Content-Type": "video/webm",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Gift-Studio-Processing-Session": processingSession,
    }).status(200).send(bytes);
  } catch (error) {
    req.log.error({ err: error }, "Gift Studio server-side video processing failed");
    throw error;
  } finally {
    if (directory && !retainedForSave) {
      await rm(directory, { recursive: true, force: true });
      studioTempDirs.delete(req);
    }
  }
});

router.post("/social/admin/gift-studio/save-processed", ownerOnly, async (req, res): Promise<void> => {
  const parsed = SaveGiftStudioProcessedBody.safeParse(req.body);
  if (!parsed.success) throw new RoomError(400, "The processed clip details are incomplete. Process the video again.");
  const session = claimGiftStudioProcessingSession(accountId(req), parsed.data.processingSession);
  if (!session) {
    throw new RoomError(410, "The temporary processed clip expired. Save again now, or process the clip again.");
  }
  try {
    const result = await createGiftStudioVersion({
      ownerId: accountId(req),
      giftId: parsed.data.giftId ?? null,
      productType: parsed.data.productType ?? session.settings.productType,
      catalogCost: parsed.data.cost,
      settings: { ...session.settings, draftName: parsed.data.draftName.trim(), productType: parsed.data.productType ?? session.settings.productType },
      originalPath: session.sourcePath,
      originalName: session.sourceName,
      originalBytes: session.sourceBytes,
      processedWebmPath: session.processedPath,
      processedWebmBytes: session.processedBytes,
    });
    await discardGiftStudioProcessingSession(session.token).catch((error) => {
      req.log.warn({ err: error }, "Gift Studio processed session cleanup failed after a saved version was created");
    });
    res.status(201).json(CreateGiftStudioVersionResponse.parse(result));
  } catch (error) {
    releaseGiftStudioProcessingSession(session.token);
    throw error;
  }
});

router.post("/social/admin/gift-studio/versions", ownerOnly, parseStudioUpload, async (req, res): Promise<void> => {
  const directory = studioTempDirs.get(req);
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const original = files?.sourceVideo?.[0];
  const processed = files?.processedWebm?.[0];
  try {
    if (!directory || !original || !processed) throw new RoomError(400, "Choose both the original clip and processed animation WebM.");
    const parsedBody = CreateGiftStudioVersionBody.safeParse({
      giftId: req.body?.giftId,
      productType: req.body?.productType,
      ...(req.body?.cost !== undefined ? { cost: Number(req.body.cost) } : {}),
      settings: req.body?.settings,
      sourceVideo: original.originalname,
      processedWebm: processed.originalname,
    });
    if (!parsedBody.success) throw new RoomError(400, "Check the selected gift and processing settings.");
    let settings: unknown;
    try {
      settings = JSON.parse(parsedBody.data.settings);
    } catch {
      throw new RoomError(400, "Processing settings could not be read.");
    }
    const validatedSettings = CreateGiftStudioVersionResponse.shape.settings.parse(settings);
    const draftName = validatedSettings.draftName?.trim();
    if (!draftName || draftName.length > 60) {
      throw new RoomError(400, "Enter a gift name of 1 to 60 characters before saving.");
    }
    const result = await createGiftStudioVersion({
      ownerId: accountId(req),
      giftId: parsedBody.data.giftId ?? null,
      productType: parsedBody.data.productType ?? validatedSettings.productType,
      catalogCost: parsedBody.data.cost,
      settings: { ...validatedSettings, draftName, productType: parsedBody.data.productType ?? validatedSettings.productType },
      originalPath: original.path,
      originalName: original.originalname,
      originalBytes: original.size,
      processedWebmPath: processed.path,
      processedWebmBytes: processed.size,
    });
    res.status(201).json(CreateGiftStudioVersionResponse.parse(result));
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      studioTempDirs.delete(req);
    }
  }
});

router.patch("/social/admin/gift-studio/versions/:versionId", ownerOnly, async (req, res): Promise<void> => {
  const params = SetGiftStudioVersionActiveParams.safeParse(req.params);
  const body = SetGiftStudioVersionActiveBody.safeParse(req.body);
  if (!params.success || !body.success) throw new RoomError(400, "Choose whether to use this gift version.");
  const result = await setGiftStudioVersionActive(accountId(req), params.data.versionId, body.data.active, {
    productType: body.data.productType,
    cost: body.data.cost,
  });
  res.json(SetGiftStudioVersionActiveResponse.parse(result));
});

router.patch("/social/admin/gift-studio/versions/:versionId/gift", ownerOnly, async (req, res): Promise<void> => {
  const params = AssignGiftStudioVersionToGiftParams.safeParse(req.params);
  const body = AssignGiftStudioVersionToGiftBody.safeParse(req.body);
  if (!params.success || !body.success) throw new RoomError(400, "Choose an existing gift.");
  const result = await assignGiftStudioVersionToGift(accountId(req), params.data.versionId, body.data.giftId);
  res.json(AssignGiftStudioVersionToGiftResponse.parse(result));
});

router.patch("/social/admin/gift-studio/versions/:versionId/name", ownerOnly, async (req, res): Promise<void> => {
  const versionId = typeof req.params.versionId === "string" ? req.params.versionId : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw new RoomError(400, "Choose a saved gift to rename.");
  if (!name || name.length > 60) throw new RoomError(400, "Gift names must be 1 to 60 characters.");
  const result = await renameGiftStudioVersion(accountId(req), versionId, name);
  res.json(CreateGiftStudioVersionResponse.parse(result));
});

router.delete("/social/admin/gift-studio/versions/:versionId/delete", ownerOnly, async (req, res): Promise<void> => {
  const versionId = typeof req.params.versionId === "string" ? req.params.versionId : "";
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw new RoomError(400, "Choose a saved gift to delete.");
  res.json(await deleteGiftStudioVersion(accountId(req), versionId));
});

router.get("/social/admin/gift-studio/versions/:versionId/media/:variant", ownerOnly, async (req, res): Promise<void> => {
  const parsed = GetGiftStudioVersionMediaParams.safeParse(req.params);
  if (!parsed.success) throw new RoomError(404, "Gift media not found.");
  await streamStudioMedia(req, res, {
    versionId: parsed.data.versionId,
    variant: parsed.data.variant,
    ownerId: accountId(req),
  });
});

router.get("/social/gift-studio/media/:versionId/:variant", async (req, res): Promise<void> => {
  const parsed = GetGiftStudioVersionMediaParams.safeParse(req.params);
  if (!parsed.success || parsed.data.variant === "original") throw new RoomError(404, "Gift media not found.");
  await streamStudioMedia(req, res, {
    versionId: parsed.data.versionId,
    variant: parsed.data.variant,
    activeOnly: true,
  });
});

router.get("/social/gift-studio/active/:giftId", async (req, res): Promise<void> => {
  const params = GetActiveGiftStudioMediaParams.safeParse(req.params);
  if (!params.success) throw new RoomError(404, "Gift not found.");
  res.set("Cache-Control", "no-store").json(GetActiveGiftStudioMediaResponse.parse(await getActiveGiftStudioMedia(params.data.giftId)));
});
const name = (raw: string | string[] | undefined) => {
  const value = typeof raw === "string" ? raw : "";
  if (!/^[A-Za-z0-9_]{3,24}$/.test(value)) throw new RoomError(400, "Invalid dedicated name");
  return value;
};
router.get("/social/favorites/gallery", async (req, res): Promise<void> => {
  res.json(GetFavoritesGalleryResponse.parse(await favoritesGallery(accountId(req))));
});
router.get("/social/favorites/:username/room", async (req, res): Promise<void> => {
  res.json(GetFavoriteRoomResponse.parse(await favoriteRoom(accountId(req), name(req.params.username))));
});
router.get("/social/gifters/leaderboard", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(GetGifterLeaderboardResponse.parse(await gifterLeaderboard(accountId(req))));
});
router.get("/social/me", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(GetSocialMeResponse.parse(await getMe(accountId(req))));
});
router.put("/social/me/name-color-test-total", async (req, res): Promise<void> => {
  sameOrigin(req);
  const id = accountId(req);
  await requireOwner(id);
  if (process.env.NODE_ENV !== "development") throw new RoomError(404, "Not found");
  const input = SetMyNameColorTestTotalBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Use a non-negative whole coin total, or clear the test override");
  setNameColorPurchaseTotalOverride(id, input.data.totalCoins);
  const progress = await nameColorProfileForAccount(id);
  roomStore.updateAccountNameColor(id, progress.color, progress.tierIndex);
  res.json(SetMyNameColorTestTotalResponse.parse({
    overrideCoins: input.data.totalCoins,
    progress: {
      tierName: progress.tierName,
      tierIndex: progress.tierIndex,
      lifetimeCoinsPurchased: progress.lifetimeCoinsPurchased,
      nextTierName: progress.nextTierName,
      nextTierThreshold: progress.nextTierThreshold,
      coinsToNextTier: progress.coinsToNextTier,
    },
  }));
});
router.get("/social/entrance-effects/shop", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(await listEntranceEffectShop(accountId(req)));
});
router.post("/social/entrance-effects/:effectId/purchase", async (req, res): Promise<void> => {
  sameOrigin(req);
  const effectId = String(req.params.effectId ?? "");
  const requestId = req.body?.requestId;
  if (!/^(good-vibes|big-love|standing-ovation|heart|spirit-pup|moonfox|cosmic-encore|fireworks|rose-shower|whip|studio-[0-9a-f-]{36})$/i.test(effectId) || typeof requestId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || Object.keys(req.body ?? {}).some(key => key !== "requestId")) {
    throw new RoomError(400, "Choose a valid entrance effect and try again.");
  }
  res.json(await purchaseEntranceEffect(accountId(req), effectId, requestId));
});
router.patch("/social/entrance-effects/equipped", async (req, res): Promise<void> => {
  sameOrigin(req);
  const effectId = req.body?.effectId;
  if (Object.keys(req.body ?? {}).some(key => key !== "effectId")
    || !(effectId === null || (typeof effectId === "string" && /^(good-vibes|big-love|standing-ovation|heart|spirit-pup|moonfox|cosmic-encore|fireworks|rose-shower|whip|studio-[0-9a-f-]{36})$/i.test(effectId)))) {
    throw new RoomError(400, "Choose an effect you own, or choose none.");
  }
  res.json(await equipEntranceEffect(accountId(req), effectId));
});
router.put("/social/me/equipped-badge", async (req, res): Promise<void> => {
  const input = EquipMyBadgeBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a badge or choose none");
  res.json(EquipMyBadgeResponse.parse(await saveEquippedBadge(accountId(req), input.data.badgeId)));
});
router.put("/social/me", async (req, res): Promise<void> => {
  const input = SaveSocialProfileBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Use a bio up to 200 characters, a valid country and up to eight interests");
  res.json(SaveSocialProfileResponse.parse(await saveSocialProfile(accountId(req), input.data)));
});
router.put("/social/me/entrance-effects", async (req, res): Promise<void> => {
  const input = UpdateMyEntranceEffectSettingsBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose an entrance-effect setting");
  res.json(UpdateMyEntranceEffectSettingsResponse.parse(await saveMyEntranceEffectSettings(accountId(req), input.data)));
});
router.get("/social/people", async (req, res): Promise<void> => {
  const input = GetSocialPeopleQueryParams.safeParse(req.query);
  if (!input.success) throw new RoomError(400, "Invalid search filters");
  // Boolean query strings must not use Boolean('false'), which is true.
  const favorites = req.query.favorites === "true";
  res.json(GetSocialPeopleResponse.parse(await listPeople(accountId(req), { ...input.data, favorites })));
});
router.get("/social/people/:username", async (req, res): Promise<void> => { res.json(GetSocialPersonResponse.parse(await getPerson(accountId(req), name(req.params.username)))); });
router.put("/social/people/:username/relationship", async (req, res): Promise<void> => {
  const input = SetSocialRelationshipBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose favorite or block and an active status");
  const actorId = accountId(req);
  const targetUsername = name(req.params.username);
  const result = await relationship(actorId, targetUsername, input.data.kind, input.data.active);
  res.json(result);
});
router.get("/social/blocks", async (req, res): Promise<void> => { res.json(GetSocialPeopleResponse.parse(await blocks(accountId(req)))); });
router.post("/social/wallet/claim", async (req, res): Promise<void> => { res.json(await claimDaily(accountId(req))); });
router.get("/social/gifts/rooms/:roomId", async (req, res) => {
  res.json(await roomGiftEvents(accountId(req), String(req.params.roomId).toUpperCase(),
    req.get('X-Room-Session') ?? '', {
      after: typeof req.query.after === 'string' ? req.query.after : undefined,
      since: typeof req.query.since === 'string' ? req.query.since : undefined,
    }));
});
router.post("/social/gifts", async (req, res): Promise<void> => {
  const input = SendSocialGiftBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a gift, recipient and valid retry key");
  if (input.data.roomId && input.data.streamId) throw new RoomError(400, "Choose either a room or a livestream.");
  const senderId = accountId(req);
  if (input.data.streamId) {
    sameOrigin(req);
    const result = await serializeGiftSends(`live:${input.data.streamId}`, async () => {
      const [recipient] = await db.select({ accountId: accountProfiles.accountId })
        .from(accountProfiles).where(eq(accountProfiles.username, input.data.recipient));
      if (!recipient) throw new RoomError(404, "This livestream is no longer available.");
      await requireLiveStreamGiftAccess(senderId, recipient.accountId, input.data.streamId!);
      return gift(senderId, input.data.recipient, input.data.giftId, input.data.idempotencyKey,
        { streamId: input.data.streamId! }, input.data.quantity ?? 1);
    });
    if ("liveGiftEvent" in result && result.liveGiftEvent) {
      const senderNameColor = await nameColorProfileForAccount(senderId);
      liveStreamChatHub.publishGift({
        ...result.liveGiftEvent,
        senderNameColor: senderNameColor.color,
        senderNameTierIndex: senderNameColor.tierIndex,
      });
    }
    if ("liveGiftEvent" in result) {
      const { liveGiftEvent: _liveGiftEvent, ...wallet } = result;
      res.json(wallet);
    } else {
      res.json(result);
    }
    return;
  }
  const context = input.data.roomId
    ? { roomId: input.data.roomId, sessionId: req.get('X-Room-Session') ?? '' }
    : undefined;
  const operation = () => gift(senderId, input.data.recipient, input.data.giftId, input.data.idempotencyKey,
    context, input.data.quantity ?? 1);
  res.json(context
    ? await serializeGiftSends(`room:${context.roomId.toUpperCase()}`, operation)
    : await operation());
});
router.post("/social/store/purchase", async (req, res): Promise<void> => {
  const input = PurchaseSocialProductBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Choose a product and valid retry key");
  res.json(await purchase(accountId(req), input.data.itemId, input.data.idempotencyKey));
});
router.get("/social/wallet/transactions", async (req, res): Promise<void> => { res.json(GetSocialLedgerResponse.parse(await ledger(accountId(req)))); });
router.get("/social/leaderboard", async (req, res): Promise<void> => { res.json(GetSocialPeopleResponse.parse(await listPeople(accountId(req), {}, true))); });
router.get("/social/messages", async (req, res): Promise<void> => { res.json(GetSocialInboxResponse.parse(await inbox(accountId(req)))); });
router.get("/social/messages/:username", async (req, res): Promise<void> => {
  const input = GetSocialConversationQueryParams.safeParse(req.query);
  if (!input.success) throw new RoomError(400, "Invalid message history cursor");
  res.json(GetSocialConversationResponse.parse(await thread(accountId(req), name(req.params.username), input.data.cursor)));
});
router.post("/social/messages/:username", async (req, res): Promise<void> => {
  const input = SendSocialMessageBody.safeParse(req.body);
  if (!input.success) throw new RoomError(400, "Write up to 1000 characters and provide a valid retry key");
  const senderId = accountId(req);
  await requireAdult(senderId);
  const chatAccess = await accessFor(senderId);
  if (chatAccess.chatMuted || chatAccess.reportsMuted) {
    throw new RoomError(403, "Chat is temporarily muted while a moderator reviews reports");
  }
  res.json(SendSocialMessageResponse.parse(await sendMessage(senderId, name(req.params.username), input.data.body, input.data.idempotencyKey)));
});
router.delete("/social/messages/:username", async (req, res): Promise<void> => { res.json(await clearThread(accountId(req), name(req.params.username))); });
export default router;

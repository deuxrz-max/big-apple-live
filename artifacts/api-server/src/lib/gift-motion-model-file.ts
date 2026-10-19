import { readFile } from "node:fs/promises";
import path from "node:path";
import { RoomError } from "./room-store";

type GltfDocument = {
  asset?: { version?: unknown };
  buffers?: Array<{ uri?: unknown }>;
  images?: Array<{ uri?: unknown }>;
};

function isSelfContained(document: GltfDocument) {
  if (document.asset?.version !== "2.0") return false;
  const embedded = (items: Array<{ uri?: unknown }> | undefined) =>
    (items ?? []).every((item) => item.uri === undefined
      || (typeof item.uri === "string" && item.uri.startsWith("data:")));
  return embedded(document.buffers) && embedded(document.images);
}

function readGlbJson(bytes: Buffer): GltfDocument | null {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") return null;
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (length > bytes.length - offset) return null;
    if (type === 0x4e4f534a) {
      try {
        return JSON.parse(bytes.toString("utf8", offset, offset + length)) as GltfDocument;
      } catch {
        return null;
      }
    }
    offset += length;
  }
  return null;
}

export async function inspectGiftMotionModelFile(filePath: string, originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  if (extension !== ".glb" && extension !== ".gltf") {
    throw new RoomError(415, "Choose a self-contained GLB or GLTF model.");
  }

  const bytes = await readFile(filePath);
  let document: GltfDocument | null = null;
  if (extension === ".glb") {
    document = readGlbJson(bytes);
  } else {
    try {
      document = JSON.parse(bytes.toString("utf8")) as GltfDocument;
    } catch {
      document = null;
    }
  }
  if (!document || !isSelfContained(document)) {
    throw new RoomError(415, "The model must be a valid, self-contained glTF 2.0 file.");
  }

  return {
    format: extension === ".glb" ? "glb" as const : "gltf" as const,
    contentType: extension === ".glb" ? "model/gltf-binary" : "model/gltf+json",
    byteSize: bytes.byteLength,
  };
}

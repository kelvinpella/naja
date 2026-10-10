import { createHash, randomBytes } from "node:crypto";
import { Zernio } from "@zernio/node";
import convert from "heic-convert";
import { getJobsServiceClient } from "./supabase-client.js";
import type { PostJobFlowMedia } from "../stages/post-job/flow.js";

export const JOB_IMAGES_BUCKET = "job_images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// PhotoPicker (camera_gallery) accepts whatever the OS gallery holds —
// iPhones default to HEIC. Anything that isn't already JPEG/PNG is
// converted to JPEG here so every format works and only jpg/png lands in
// storage (matching WhatsApp Cloud API image limits).
const HEIC_MIME = new Set(["image/heic", "image/heif"]);
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

function isHeicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const box = String.fromCharCode(...bytes.slice(4, 8));
  if (box !== "ftyp") return false;
  const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
  return HEIC_BRANDS.has(brand);
}

const zernioMediaClients = new Map<string, Zernio>();
function getZernioMedia(apiKey: string): Zernio {
  let client = zernioMediaClients.get(apiKey);
  if (!client) {
    client = new Zernio({ apiKey });
    zernioMediaClients.set(apiKey, client);
  }
  return client;
}

const ALLOWED_PASSTHROUGH_MIME = new Set(["image/jpeg", "image/png"]);

function folderFor(phone: string | undefined, fallback: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  // Hash the phone — raw digits in the path leak PII and are enumerable.
  if (digits.length >= 5) {
    return createHash("sha256").update(digits).digest("hex").slice(0, 16);
  }
  return `user_${createHash("sha256").update(fallback).digest("hex").slice(0, 12)}`;
}

function isValidMediaShape(item: unknown): item is PostJobFlowMedia {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  const id = record["id"] ?? record["media_id"];
  const idOk = typeof id === "string" ? id.length > 0 : typeof id === "number";
  if (!idOk) return false;
  const mime = record["mime_type"];
  if (mime !== undefined && typeof mime !== "string") return false;
  return true;
}

export function normalizePostJobMedia(value: unknown): PostJobFlowMedia | null {
  if (!value) return null;
  const item = Array.isArray(value) ? value[0] : value;
  if (!isValidMediaShape(item)) return null;
  return item;
}

// Flow PhotoPicker uploads in `complete` mode arrive as
// [{id, mime_type, sha256, file_name}] — no cdn_url (that shape only comes
// from a data_exchange endpoint). The id is a WhatsApp media id, fetched
// here via the official @zernio/node SDK (GET /v1/whatsapp/media/{mediaId}).
// Fetch promptly: Meta drops inbound media after a short retention window.
export async function uploadPostJobImage(
  media: PostJobFlowMedia,
  opts: {
    userPhone?: string;
    personKey: string;
    accountId: string;
    apiKey: string;
    signal?: AbortSignal;
  },
): Promise<{ url: string; path: string }> {
  const rawId = media.id ?? media.media_id;
  const mediaId =
    typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : undefined;
  if (!mediaId) throw new Error("Image media ID missing in Flow response");
  const zernio = getZernioMedia(opts.apiKey);
  const { data, error } = await zernio.whatsapp.getWhatsAppMedia({
    path: { mediaId },
    query: { accountId: opts.accountId },
    signal: opts.signal,
  });
  if (error || !data) throw new Error("Image download failed", { cause: error });
  const blob = data as Blob;
  // Check size before buffering the whole file into memory.
  const headerLength = typeof (blob as { size?: unknown }).size === "number"
    ? (blob as { size: number }).size
    : typeof (blob as { length?: unknown }).length === "number"
      ? (blob as unknown as { length: number }).length
      : undefined;
  if (headerLength !== undefined && headerLength > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 5MB limit");
  }
  const downloaded = new Uint8Array(await blob.arrayBuffer());
  if (downloaded.length === 0) throw new Error("Downloaded image is empty");
  if (downloaded.length > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 5MB limit");
  }
  const declaredMime =
    typeof media.mime_type === "string" && media.mime_type
      ? media.mime_type.toLowerCase()
      : "";
  const blobMime = typeof blob.type === "string" ? blob.type.toLowerCase() : "";
  const mime = blobMime || declaredMime || "image/jpeg";
  const normalizedMime = mime === "image/jpg" ? "image/jpeg" : mime;
  const fileName =
    typeof media.file_name === "string" ? media.file_name : undefined;
  const lowerName = (fileName ?? "").toLowerCase();
  const looksHeic =
    HEIC_MIME.has(normalizedMime) ||
    lowerName.endsWith(".heic") ||
    lowerName.endsWith(".heif") ||
    isHeicBytes(downloaded);
  // Normalize everything to jpg/png: HEIC gets converted so any phone
  // format uploads cleanly; jpg/png pass through untouched. Anything else
  // (webp/gif/svg/...) is rejected — heic-convert only handles HEIC.
  let bytes = downloaded;
  let contentType = normalizedMime;
  if (looksHeic) {
    try {
      bytes = Uint8Array.from(
        await convert({ buffer: downloaded, format: "JPEG", quality: 0.9 }),
      );
    } catch (error) {
      throw new Error(
        `HEIC conversion failed (mime=${normalizedMime || "unknown"}, bytes=${downloaded.length})`,
        { cause: error },
      );
    }
    contentType = "image/jpeg";
  } else if (!ALLOWED_PASSTHROUGH_MIME.has(normalizedMime)) {
    throw new Error(
      `Unsupported image format: ${normalizedMime || "unknown"}. Tumia JPG au PNG.`,
    );
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds 5MB limit");
  }
  const ext = contentType === "image/png" ? "png" : "jpg";
  const folder = folderFor(opts.userPhone, opts.personKey);
  // NOTE: bucket stays public (WhatsApp carousel fetches by URL long after
  // upload, so signed URLs would expire). Hashed folders make paths unenumerable.
  const uploadOnce = async (storagePath: string) =>
    getJobsServiceClient()
      .storage.from(JOB_IMAGES_BUCKET)
      .upload(storagePath, bytes, {
        contentType,
        upsert: false,
      });
  let unique = `${Date.now()}_${randomBytes(4).toString("hex")}`;
  let path = `${folder}/${unique}.${ext}`;
  let { error: uploadError } = await uploadOnce(path);
  if (uploadError && /duplicate|already exists|409/i.test(uploadError.message ?? "")) {
    unique = `${Date.now()}_${randomBytes(8).toString("hex")}`;
    path = `${folder}/${unique}.${ext}`;
    ({ error: uploadError } = await uploadOnce(path));
  }
  if (uploadError) throw new Error("Job image upload failed", { cause: uploadError });
  const { data: urlData } = getJobsServiceClient()
    .storage.from(JOB_IMAGES_BUCKET)
    .getPublicUrl(path);
  return { url: urlData.publicUrl, path };
}

// Best-effort orphan cleanup: if the jobs insert fails after the image
// upload succeeded, remove the file so failed posts don't pile up in
// the bucket. Never throws — callers must still surface the original error.
export async function deletePostJobImage(storagePath: string): Promise<void> {
  try {
    const { error } = await getJobsServiceClient().storage.from(JOB_IMAGES_BUCKET).remove([storagePath]);
    if (error) {
      console.warn("[job-image-storage] orphan cleanup failed:", error.message ?? error);
    }
  } catch (error) {
    // Ignore: orphan cleanup must not mask the publish failure.
    console.warn("[job-image-storage] orphan cleanup threw:", error instanceof Error ? error.message : error);
  }
}

import { randomBytes } from "node:crypto";
import type { PostJobMedia } from "../flows/post-job-flow.js";
import { getKapsoClient, withAbort } from "../kapso-client.js";
import { getJobsClient } from "./supabase-client.js";

export const JOB_IMAGES_BUCKET = "job_images";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function folderFor(phone: string | undefined, personKey: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length >= 5) return digits;
  return `person_${personKey.slice(0, 12)}`;
}

export function normalizePostJobMedia(value: unknown): PostJobMedia | null {
  if (!value) return null;
  const item = Array.isArray(value) ? value[0] : value;
  if (!item || typeof item !== "object") return null;
  return item as PostJobMedia;
}

function mediaIdOf(media: PostJobMedia): string | undefined {
  const raw = media.id ?? media.media_id;
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  return undefined;
}

/**
 * Fetches the photo the Flow's PhotoPicker uploaded. The completion carries a
 * WhatsApp media id, not bytes and not a URL. Bytes are returned as they
 * arrived: there is no conversion and no format check (ADR 0006), only the
 * size guard the Flow already promises.
 */
export async function downloadPostJobImage(
  media: PostJobMedia,
  opts: {
    apiKey: string;
    phoneNumberId: string;
    signal: AbortSignal;
  },
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const mediaId = mediaIdOf(media);
  if (!mediaId) throw new Error("Image media ID missing in the Flow response");

  const downloaded = await withAbort(
    getKapsoClient(opts.apiKey).media.download({
      mediaId,
      phoneNumberId: opts.phoneNumberId,
      as: "arrayBuffer",
    }),
    opts.signal,
  );
  const bytes = new Uint8Array(downloaded as ArrayBuffer);
  if (bytes.length === 0) throw new Error("Downloaded image is empty");
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds the 5MB limit");
  }

  const declaredType = media.mime_type ?? media.mimeType;
  const declared =
    typeof declaredType === "string" ? declaredType.toLowerCase() : "";
  return { bytes, contentType: declared || "image/jpeg" };
}

export async function uploadPostJobImage(
  bytes: Uint8Array,
  contentType: string,
  opts: { personKey: string; userPhone?: string },
): Promise<{ url: string; path: string }> {
  const ext = contentType === "image/png" ? "png" : "jpg";
  const folder = folderFor(opts.userPhone, opts.personKey);
  const path = `${folder}/${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;

  const { error } = await getJobsClient()
    .storage.from(JOB_IMAGES_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error("Job image upload failed", { cause: error });

  const { data } = getJobsClient()
    .storage.from(JOB_IMAGES_BUCKET)
    .getPublicUrl(path);
  return { url: data.publicUrl, path };
}

// Best effort: if the insert fails after the image was stored, remove the file
// so failed posts don't pile up in the bucket. Never throws — the original
// error is what the retry path must surface.
export async function deletePostJobImage(storagePath: string): Promise<void> {
  try {
    await getJobsClient().storage.from(JOB_IMAGES_BUCKET).remove([storagePath]);
  } catch {
    // Ignore: orphan cleanup must not mask the publish failure.
  }
}

import type { JobListing, JobPage } from "./job-types.js";

export const JOB_CARD_IMAGE_URL =
  process.env["NAJA_JOB_CARD_IMAGE_URL"] ??
  "https://res.cloudinary.com/dpw2dpthx/image/upload/v1791342164/kazi_mpya_kvncsh.jpg";

export const MORE_CARD_IMAGE_URL =
  process.env["NAJA_MORE_CARD_IMAGE_URL"] ??
  "https://res.cloudinary.com/dpw2dpthx/image/upload/v1791499669/gallery_image_20261007_060131-replace-text-with-tizama-kazi-zaidi-at-slightly-sm_yroyqr.jpg";

export const JOB_DETAIL_PREFIX = "job_detail";
export const JOB_APPLY_PREFIX = "job_apply";
export const JOB_MORE_PREFIX = "job_more";

export const DETAIL_BUTTON_TITLE = "Soma zaidi";
export const APPLY_BUTTON_TITLE = "Omba";
export const MORE_BUTTON_TITLE = "Tizama kazi zaidi";

export type ListOrigin =
  | { kind: "search"; keyword: string }
  | { kind: "mixed" };

export type CarouselCard = {
  imageUrl: string;
  body: string;
  buttons: { id: string; title: string }[];
};

export type JobListView =
  | { kind: "empty" }
  | { kind: "single"; job: JobListing }
  | { kind: "carousel"; heading: string; cards: CarouselCard[] };

export function excerpt(description: string | null, limit = 150): string {
  if (limit <= 0) return "";
  const text = (description ?? "").trim();
  if (text.length <= limit) return text;
  return `${Array.from(text).slice(0, limit).join("")}...`;
}

const CARD_BODY_LIMIT = 155;

export function fitTitle(title: string | null, limit = 50): string {
  const text = (title?.trim() || "Kazi").replace(/\n+/g, " ");
  if (Array.from(text).length <= limit) return text;
  return `${Array.from(text).slice(0, Math.max(0, limit - 3)).join("")}...`;
}

export function fitArea(area: string | null | undefined, limit = 30): string {
  const text = (area ?? "").trim().replace(/\n+/g, " ");
  if (!text) return "";
  if (Array.from(text).length <= limit) return text;
  return `${Array.from(text).slice(0, Math.max(0, limit - 3)).join("")}...`;
}

export function formatPostedDate(createdAt: string): string {
  const time = new Date(createdAt).getTime();
  if (Number.isNaN(time)) return "";
  const date = new Date(time);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

export function formatAmount(budget: number): string {
  if (!Number.isFinite(budget) || budget < 0) return "Tsh: —";
  return `Tsh: ${Math.floor(budget).toLocaleString("en-US")}`;
}

export function cardBody(job: JobListing): string {
  const title = fitTitle(job.title);
  const date = formatPostedDate(job.createdAt);
  const areaTag = fitArea(job.area) ? `📍 ${fitArea(job.area)}` : "";
  // Area rides the date line (no room for a footer: Meta carousel cards
  // have header + body + buttons only). Same line breaks as before.
  const secondLine = [date, areaTag].filter(Boolean).join("   ");
  const amountLine = job.budget !== null ? formatAmount(job.budget) : "";
  const head = secondLine ? `*${title}*\n${secondLine}\n\n` : `*${title}*\n\n`;
  const tail = amountLine ? `\n\n${amountLine}` : "";
  let descBudget = CARD_BODY_LIMIT - head.length - tail.length;
  let tailOut = tail;
  if (descBudget < 20 && tail) {
    tailOut = "";
    descBudget = CARD_BODY_LIMIT - head.length;
  }
  const desc = excerpt(job.description, Math.max(0, descBudget));
  return `${head}${desc}${tailOut}`;
}

const DETAIL_BODY_LIMIT = 1000;

export function fullDetailBody(job: JobListing): string {
  const title = fitTitle(job.title, 80);
  const date = formatPostedDate(job.createdAt);
  const areaTag = fitArea(job.area, 80) ? `📍 ${fitArea(job.area, 80)}` : "";
  const secondLine = [date, areaTag].filter(Boolean).join("   ");
  const amount = job.budget !== null ? formatAmount(job.budget) : "";
  const head = secondLine ? `*${title}*\n${secondLine}\n\n` : `*${title}*\n\n`;
  const tail = amount ? `\n\n${amount}` : "";
  // excerpt() can append "..." past the limit, so reserve those 3 chars.
  const descBudget = DETAIL_BODY_LIMIT - head.length - tail.length - 3;
  const desc = excerpt((job.description ?? "").trim() || "—", Math.max(0, descBudget));
  return `${head}${desc}${tail}`;
}

export function detailPayload(jobId: string): string {
  return `${JOB_DETAIL_PREFIX}:${jobId}`;
}

export function applyPayload(jobId: string): string {
  return `${JOB_APPLY_PREFIX}:${jobId}`;
}

// Meta caps quick-reply ids at 256 chars: shrink the keyword until the
// encoded cursor fits with margin.
const MORE_ID_BUDGET = 200;

export function morePayload(origin: ListOrigin, offset: number): string {
  if (origin.kind === "mixed") return `${JOB_MORE_PREFIX}:mixed:${offset}`;
  let raw = origin.keyword.slice(0, 60);
  let id = `${JOB_MORE_PREFIX}:search:${encodeURIComponent(raw)}:${offset}`;
  while (id.length > MORE_ID_BUDGET && raw.length > 1) {
    raw = raw.slice(0, Math.floor(raw.length / 2));
    id = `${JOB_MORE_PREFIX}:search:${encodeURIComponent(raw)}:${offset}`;
  }
  return id;
}

export function parseJobPayload(
  payload: string | undefined,
): { stage: "detail"; jobId: string } | { stage: "apply"; jobId: string } | null {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 2) return null;
  const [prefix, jobId] = parts;
  if (!jobId || !/^[A-Za-z0-9-]{1,64}$/.test(jobId)) return null;
  if (prefix === JOB_DETAIL_PREFIX) return { stage: "detail", jobId };
  if (prefix === JOB_APPLY_PREFIX) return { stage: "apply", jobId };
  return null;
}

export type MoreCursor =
  | { origin: ListOrigin; offset: number }
  | null;

export function parseMorePayload(payload: string | undefined): MoreCursor {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts[0] !== JOB_MORE_PREFIX || parts.length < 3) return null;
  const offset = Number(parts[parts.length - 1]);
  if (!Number.isInteger(offset) || offset < 0) return null;
  const middle = parts.slice(1, -1).join(":");
  if (middle === "mixed") return { origin: { kind: "mixed" }, offset };
  if (middle.startsWith("search:")) {
    try {
      const keyword = decodeURIComponent(middle.slice("search:".length));
      if (!keyword) return null;
      return { origin: { kind: "search", keyword }, offset };
    } catch {
      return null;
    }
  }
  return null;
}

function safeImageUrl(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return fallback;
    if (!parsed.hostname) return fallback;
    return url;
  } catch {
    return fallback;
  }
}

function jobCard(job: JobListing): CarouselCard {
  return {
    imageUrl: safeImageUrl(job.jobImage, JOB_CARD_IMAGE_URL),
    body: cardBody(job),
    buttons: [
      { id: detailPayload(job.id), title: DETAIL_BUTTON_TITLE },
      { id: applyPayload(job.id), title: APPLY_BUTTON_TITLE },
    ],
  };
}

function moreCard(origin: ListOrigin, nextOffset: number): CarouselCard {
  // Meta requires every card in a carousel to carry the same number of
  // buttons, so the navigation card carries Rudi nyuma as its second button.
  return {
    imageUrl: MORE_CARD_IMAGE_URL,
    body: `*${MORE_BUTTON_TITLE}*\n\nBofya kuona kazi zinazofuata.`,
    buttons: [
      { id: morePayload(origin, nextOffset), title: MORE_BUTTON_TITLE },
      { id: "get_started", title: "Rudi nyuma" },
    ],
  };
}

export function buildJobListView(
  page: JobPage,
  origin: ListOrigin,
  offset: number,
  heading: string,
): JobListView {
  if (page.jobs.length === 0) return { kind: "empty" };
  if (page.jobs.length === 1 && !page.hasMore) {
    return { kind: "single", job: page.jobs[0] };
  }
  const cards = page.jobs.map(jobCard);
  if (page.hasMore) {
    cards.push(moreCard(origin, offset + page.jobs.length));
  }
  return { kind: "carousel", heading, cards };
}

export function applyConfirmationBody(phone: string): string {
  // Full number is intentional: the user tapped Omba to request the poster's contact.
  const clean = phone.trim();
  if (!clean) return "✅ Ombi limepokelewa. Tutakujulisha hatua zinazofuata.";
  return `✅ Waweza wasiliana na aliyetangaza hii kazi kwa namba hizi hapa chini.\n\nPhone:${clean}`;
}

export function searchHeading(keyword: string): string {
  const clean = keyword.trim().slice(0, 100);
  return `Hizi ndizo kazi zilizotangazwa: ${clean}`;
}

export const MIXED_HEADING = "Hizi ndizo kazi mchanganyiko. Swipe kutizama zaidi";
export const MORE_BATCH_HEADING = "Kazi zaidi zilizotangazwa";

export function emptySearchBody(keyword: string): string {
  const clean = keyword.trim().slice(0, 60);
  if (!clean) return "Hakuna kazi iliyopatikana. Jaribu neno lingine.";
  return `Hakuna kazi iliyopatikana kwa neno "${clean}". Jaribu neno lingine.`;
}
export const EMPTY_MIXED_BODY = "Hakuna kazi zilizotangazwa kwa sasa.";

import type { JobListing } from "./job-types.js";

// Meta's carousel limits: two to ten cards, 160 characters and two line breaks
// per card body, and a button label of at most 20. Staying inside them here is
// what lets the reply go out as a carousel instead of degrading to plain text.
export const MIN_CAROUSEL_CARDS = 2;
export const MAX_CAROUSEL_CARDS = 10;
export const CARD_BODY_LIMIT = 155;
export const CARD_BODY_LINE_BREAKS = 2;
const BUTTON_TITLE_LIMIT = 20;
const DETAIL_BODY_LIMIT = 1000;

/** Cards need a header image; Jobs without a photo get this. */
export const JOB_CARD_PLACEHOLDER_IMAGE =
  "https://placehold.co/600x400/png?text=Naja+Kazi";

export const APPLY_BUTTON_TITLE = "Omba";
export const APPLY_PAYLOAD_PREFIX = "job_apply";
export const DETAIL_BUTTON_TITLE = "Soma zaidi";
export const DETAIL_PAYLOAD_PREFIX = "job_detail";

export type CarouselCard = {
  imageUrl: string;
  body: string;
  buttons: { id: string; title: string }[];
};

export function excerpt(description: string | null, limit = 150): string {
  const text = (description ?? "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

export function fitTitle(title: string | null, limit = 50): string {
  const text = (title?.trim() || "Kazi").replace(/\n+/g, " ");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

export function formatPostedDate(createdAt: string): string {
  const time = new Date(createdAt).getTime();
  if (Number.isNaN(time)) return "";
  const date = new Date(time);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

export function formatAmount(budget: number): string {
  return `Tsh ${budget.toLocaleString("en-US")}`;
}

function oneLine(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The card's text: title, posted date and amount on one line, then an excerpt.
 * Exactly two line breaks at most — the carousel sender rejects a card with
 * more, and then the whole reply degrades to numbered text.
 */
export function cardBody(job: JobListing): string {
  const title = fitTitle(job.title);
  const date = formatPostedDate(job.createdAt);
  const amount = job.budget !== null ? formatAmount(job.budget) : "";
  const meta = [date, amount].filter(Boolean).join(" · ");
  const head = meta ? `*${title}*\n${meta}` : `*${title}*`;
  // Reserve the newline before the excerpt and the three characters excerpt()
  // may append, so the body never crosses CARD_BODY_LIMIT.
  const descBudget = CARD_BODY_LIMIT - head.length - 1 - 3;
  const desc =
    descBudget > 0 ? excerpt(oneLine(job.description), descBudget) : "";
  return desc ? `${head}\n${desc}` : head;
}

export function detailPayload(jobId: string): string {
  return `${DETAIL_PAYLOAD_PREFIX}:${jobId}`;
}

export function applyPayload(jobId: string): string {
  return `${APPLY_PAYLOAD_PREFIX}:${jobId}`;
}

/** Reads a `job_detail:<id>` payload back off a tapped card button. */
export function parseDetailPayload(payload: string | undefined): string | null {
  if (!payload?.startsWith(`${DETAIL_PAYLOAD_PREFIX}:`)) return null;
  const id = payload.slice(DETAIL_PAYLOAD_PREFIX.length + 1).trim();
  return id || null;
}

/** Reads a `job_apply:<id>` payload back off a tapped Omba button. */
export function parseApplyPayload(payload: string | undefined): string | null {
  if (!payload?.startsWith(`${APPLY_PAYLOAD_PREFIX}:`)) return null;
  const id = payload.slice(APPLY_PAYLOAD_PREFIX.length + 1).trim();
  return id || null;
}

/**
 * What a tapped Omba gets: the poster's phone, so the two can talk. The
 * application itself is not stored and the poster is not notified yet.
 */
export function jobApplyText(job: {
  title: string | null;
  posterPhone: string | null;
}): string {
  const title = fitTitle(job.title, 80);
  const phone = job.posterPhone?.trim();
  if (!phone) {
    return `✅ Ombi limepokelewa kwa *${title}*.\n\nAliyetangaza kazi hakutoa namba ya mawasiliano. Tutakujulisha hatua zinazofuata.`;
  }
  return `✅ Ombi limepokelewa kwa *${title}*.\n\nWasiliana na aliyetangaza kazi kwa namba hii:\n\nPhone: ${phone}`;
}

/**
 * One card per Job, capped at Meta's ten. Every card carries the same two
 * buttons in the same order — `Omba`, then `Soma zaidi` — because a carousel
 * whose cards disagree on buttons is rejected whole.
 */
export function buildJobCards(jobs: JobListing[]): CarouselCard[] {
  return jobs.slice(0, MAX_CAROUSEL_CARDS).map((job) => ({
    imageUrl: job.jobImage?.trim() || JOB_CARD_PLACEHOLDER_IMAGE,
    body: cardBody(job),
    buttons: [
      {
        id: applyPayload(job.id),
        title: APPLY_BUTTON_TITLE.slice(0, BUTTON_TITLE_LIMIT),
      },
      {
        id: detailPayload(job.id),
        title: DETAIL_BUTTON_TITLE.slice(0, BUTTON_TITLE_LIMIT),
      },
    ],
  }));
}

/** The text a `get-job` tap is answered with, clamped to WhatsApp's limit. */
export function jobDetailText(job: JobListing): string {
  const title = fitTitle(job.title, 80);
  const date = formatPostedDate(job.createdAt);
  const amount = job.budget !== null ? formatAmount(job.budget) : "";
  const area = job.area?.trim() ? `Eneo: ${job.area.trim()}` : "";
  const head = date ? `*${title}*\n${date}\n\n` : `*${title}*\n\n`;
  const tail = [area, amount].filter(Boolean).join("\n");
  const tailBlock = tail ? `\n\n${tail}` : "";
  // excerpt() can append "..." past the limit, so reserve those 3 chars.
  const descBudget =
    DETAIL_BODY_LIMIT - head.length - tailBlock.length - 3;
  const desc = excerpt(
    (job.description ?? "").trim() || "—",
    Math.max(0, descBudget),
  );
  return `${head}${desc}${tailBlock}`;
}

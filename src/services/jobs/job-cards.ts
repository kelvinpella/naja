import type { JobListing } from "./job-types.js";

// Meta's carousel limits: ten cards, 160 characters per card body, and a
// button label of at most 20. Staying inside them here is what lets the reply
// go out as a carousel instead of degrading to plain text.
export const MAX_CAROUSEL_CARDS = 10;
const CARD_BODY_LIMIT = 155;
const BUTTON_TITLE_LIMIT = 20;
const DETAIL_BODY_LIMIT = 1000;

/** Cards need a header image; Jobs without a photo get this. */
export const JOB_CARD_PLACEHOLDER_IMAGE =
  "https://placehold.co/600x400/png?text=Naja+Kazi";

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

/** The card's text: title, posted date, an excerpt, then the amount. */
export function cardBody(job: JobListing): string {
  const title = fitTitle(job.title);
  const date = formatPostedDate(job.createdAt);
  const amountLine = job.budget !== null ? formatAmount(job.budget) : "";
  const head = date ? `*${title}*\n${date}\n\n` : `*${title}*\n\n`;
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

export function detailPayload(jobId: string): string {
  return `${DETAIL_PAYLOAD_PREFIX}:${jobId}`;
}

/** Reads a `job_detail:<id>` payload back off a tapped card button. */
export function parseDetailPayload(payload: string | undefined): string | null {
  if (!payload?.startsWith(`${DETAIL_PAYLOAD_PREFIX}:`)) return null;
  const id = payload.slice(DETAIL_PAYLOAD_PREFIX.length + 1).trim();
  return id || null;
}

/**
 * One card per Job, capped at Meta's ten. Each card has exactly one button —
 * a detail tap — because a carousel requires every card to carry the same
 * number of buttons, and the detail reply is where the Job is acted on.
 */
export function buildJobCards(jobs: JobListing[]): CarouselCard[] {
  return jobs.slice(0, MAX_CAROUSEL_CARDS).map((job) => ({
    imageUrl: job.jobImage?.trim() || JOB_CARD_PLACEHOLDER_IMAGE,
    body: cardBody(job),
    buttons: [
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

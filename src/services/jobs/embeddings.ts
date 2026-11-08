import OpenAI from "openai";

/**
 * pgvector's HNSW index stops at 2000 dimensions, so `jobs.embedding` is 1536
 * even though gemini-embedding-001 emits 3072 (ADR 0008). The router is asked
 * for 1536; if it ignores `dimensions`, the tail is dropped here — Matryoshka
 * truncation keeps the leading dimensions meaningful.
 */
export const EMBEDDING_DIMENSIONS = 1536;

const DEFAULT_MODEL = "gemini-embedding-001";
const DEFAULT_BASE_URL = "http://localhost:3001/v1";

/** Any reason the embedding provider could not answer, in one type. */
export class EmbeddingUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingUnavailableError";
  }
}

// FreeLLMAPI is the same OpenAI-compatible router the chat model uses, so one
// key configures both. Clients are cheap config objects; build one per call
// rather than freezing `fetch` at boot (see kapso-client).
function embeddingsClient(): OpenAI {
  const apiKey = process.env["FREELLMAPI_API_KEY"]?.trim();
  if (!apiKey) {
    throw new EmbeddingUnavailableError(
      "FREELLMAPI_API_KEY is not set, so nothing can be embedded",
    );
  }
  const baseURL = (
    process.env["FREELLMAPI_BASE_URL"]?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  return new OpenAI({ apiKey, baseURL });
}

/**
 * gemini-embedding-001 only normalizes its default 3072-dimension output, so a
 * truncated vector arrives unnormalized. Every vector — query and Job — goes
 * through here before it is compared or stored.
 */
export function l2Normalize(values: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of values) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new EmbeddingUnavailableError("Embedding has no direction");
  }
  return values.map((value) => value / norm);
}

/** Fits a provider vector to the stored width and normalizes it. */
export function fitEmbedding(values: number[]): number[] {
  if (values.length < EMBEDDING_DIMENSIONS) {
    throw new EmbeddingUnavailableError(
      `Embedding returned ${values.length} dimensions, expected at least ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return l2Normalize(values.slice(0, EMBEDDING_DIMENSIONS));
}

/**
 * Embeds one or more texts in a single request. Order is preserved by index,
 * because the router may answer out of order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await embeddingsClient().embeddings.create({
    model: process.env["EMBEDDING_MODEL"]?.trim() || DEFAULT_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  if (response.data.length !== texts.length) {
    throw new EmbeddingUnavailableError(
      `Embedding response has ${response.data.length} vectors for ${texts.length} inputs`,
    );
  }

  return [...response.data]
    .sort((a, b) => a.index - b.index)
    .map((item) => fitEmbedding(item.embedding));
}

/** What a Job contributes to its embedding — the same surface search_vector uses. */
export function jobEmbeddingText(job: {
  title: string | null;
  description: string | null;
  area: string | null;
  skills?: string[] | null;
}): string {
  return [job.title, job.description, job.area, ...(job.skills ?? [])]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Embedding a Job must never stop it from being published (ADR 0008): a
 * failure leaves `jobs.embedding` null and the Posting reports it, so the
 * listing stays keyword-searchable and `npm run jobs:embed` fills it in.
 */
export async function embedJobTextOrNull(job: {
  title: string | null;
  description: string | null;
  area: string | null;
  skills?: string[] | null;
}): Promise<number[] | null> {
  const text = jobEmbeddingText(job);
  if (!text) return null;
  try {
    const [vector] = await embedTexts([text]);
    return vector ?? null;
  } catch {
    return null;
  }
}

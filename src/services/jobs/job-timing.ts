import type { FastifyBaseLogger } from "fastify";

export type JobsTimingRecord = {
  op: "list" | "get-by-id";
  ms: number;
  bytes: number;
  count: number;
};

export type JobsTimingSink = (record: JobsTimingRecord) => void;

let sink: JobsTimingSink | null = null;

export function setJobsTimingSink(next: JobsTimingSink | null): void {
  sink = next;
}

export function resetJobsTimingSink(): void {
  sink = null;
}

export function connectJobsTimingToLogger(logger: FastifyBaseLogger): void {
  setJobsTimingSink((record) => {
    logger.info(record, "Job read timing");
  });
}

export async function timeJobRead<T>(
  op: JobsTimingRecord["op"],
  countOf: (result: T) => number,
  read: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  const ms = () => Math.round((performance.now() - start) * 10) / 10;
  try {
    const result = await read();
    sink?.({
      op,
      ms: ms(),
      bytes: Buffer.byteLength(JSON.stringify(result ?? null)),
      count: countOf(result),
    });
    return result;
  } catch (error) {
    sink?.({ op, ms: ms(), bytes: 0, count: 0 });
    throw error;
  }
}

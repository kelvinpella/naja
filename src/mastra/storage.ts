import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LibSQLStore } from "@mastra/libsql";

/**
 * The repository root, independent of the process working directory.
 *
 * `mastra dev` changes the working directory before it loads the app (it runs
 * the bundle from the Studio asset folder), so a relative `file:./.data/...`
 * opens a second, empty database there and Studio lists no Threads. npm hands
 * every script the absolute path of this package's `package.json`, which is
 * the stable anchor.
 */
function projectRoot(): string {
  const packageJson = process.env.npm_package_json;
  if (packageJson) return dirname(packageJson);

  // Direct invocations (`node --import tsx src/worker.ts`, the compiled worker)
  // keep the repository root as their working directory. This file sits at
  // `<root>/src/mastra/storage.ts`, and the CLI bundles the same code into
  // `<root>/.mastra/output/index.mjs`; two levels up is the root either way.
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

// One SQLite file holds threads, messages, and the observation log, plus the
// traces Studio reads. Observational Memory needs a supported adapter (LibSQL,
// Postgres, MySQL, MongoDB, Convex, Oracle) — Redis is not one.
const DATA_DIR = join(projectRoot(), ".data");
export const MEMORY_DB_PATH = join(DATA_DIR, "mastra.db");

mkdirSync(DATA_DIR, { recursive: true });

// Printed once at startup because a wrong path is silent otherwise: the app
// happily creates an empty database somewhere else and looks like it has never
// spoken to anyone.
console.log(`Mastra memory: ${MEMORY_DB_PATH}`);

export const memoryStorage = new LibSQLStore({
  id: "naja-memory",
  url: `file:${MEMORY_DB_PATH}`,
});

const PREVIEW_FIELDS = [
  "inputPreview",
  "outputPreview",
  "errorPreview",
] as const;

/**
 * Turns span previews that came back as objects back into the text stored.
 *
 * `@mastra/libsql` JSON-parses every column value that begins with `{` or `[`
 * when it reads a row, not just the `jsonb` columns. Span previews are plain
 * text, but a preview of an object payload is compact JSON
 * (`{"kind":"buttons",…}`), so it is read back as an object and Mastra's
 * trace list calls `.trim()` on it. One such span fails the whole page with
 * `TypeError: stored.trim is not a function`, which empties Studio's Traces
 * view. Re-serialize the previews so readers get the strings that were stored.
 *
 * Remove once the adapter only parses `jsonb` columns upstream.
 */
function restorePreviewText<T extends object>(span: T): T {
  const record = span as Record<string, unknown>;
  let restored: Record<string, unknown> | undefined;

  for (const field of PREVIEW_FIELDS) {
    const value = record[field];
    if (value == null || typeof value === "string") continue;
    restored ??= { ...record };
    restored[field] = JSON.stringify(value);
  }

  return (restored ?? span) as T;
}

function restoreSpanList<T extends { spans: object[] }>(response: T): T {
  return { ...response, spans: response.spans.map(restorePreviewText) };
}

// Every observability read goes through the adapter method that mangles
// previews, so wrap the reads that return spans. `listTracesLight` and
// `getStructure` route through these same methods.
const observability = memoryStorage.stores.observability;
if (observability) {
  const listTraces = observability.listTraces.bind(observability);
  observability.listTraces = async (args) =>
    restoreSpanList(await listTraces(args));

  const getTrace = observability.getTrace.bind(observability);
  observability.getTrace = async (args) => {
    const response = await getTrace(args);
    return response && restoreSpanList(response);
  };

  // The adapter implements this read under the deprecated `getTraceLight`
  // name and Studio's trace route calls that name directly, so it needs the
  // same wrapping. Going through this local shape keeps the deprecated member
  // off the adapter's type surface. `getStructure` delegates here too.
  const lightTraceReader = observability as unknown as {
    getTraceLight: (
      args: { traceId: string },
    ) => Promise<{ traceId: string; spans: object[] } | null>;
  };
  const getTraceLight = lightTraceReader.getTraceLight.bind(observability);
  lightTraceReader.getTraceLight = async (args) => {
    const response = await getTraceLight(args);
    return response && restoreSpanList(response);
  };

  const getSpan = observability.getSpan.bind(observability);
  observability.getSpan = async (args) => {
    const response = await getSpan(args);
    return response && { ...response, span: restorePreviewText(response.span) };
  };

  const getRootSpan = observability.getRootSpan.bind(observability);
  observability.getRootSpan = async (args) => {
    const response = await getRootSpan(args);
    return response && { ...response, span: restorePreviewText(response.span) };
  };
}

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

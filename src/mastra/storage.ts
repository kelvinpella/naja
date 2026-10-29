import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LibSQLStore } from "@mastra/libsql";

// One SQLite file holds threads, messages, and the observation log. Relative
// to the project root, which is the working directory for `npm run dev` and
// for the compiled worker. Observational Memory needs a supported adapter
// (LibSQL, Postgres, MySQL, MongoDB, Convex, Oracle) — Redis is not one.
const STORAGE_URL = "file:./.data/mastra.db";

if (STORAGE_URL.startsWith("file:")) {
  mkdirSync(dirname(STORAGE_URL.slice("file:".length)), { recursive: true });
}

export const memoryStorage = new LibSQLStore({
  id: "naja-memory",
  url: STORAGE_URL,
});

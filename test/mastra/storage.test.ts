import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MEMORY_DB_PATH } from "../../src/mastra/storage.js";

// This file lives at <root>/test/mastra/storage.test.ts.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("MEMORY_DB_PATH", () => {
  it("points at the project's own database, not at the working directory", () => {
    assert.equal(MEMORY_DB_PATH, join(PROJECT_ROOT, ".data", "mastra.db"));
  });
});

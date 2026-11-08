import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMBEDDING_DIMENSIONS,
  EmbeddingUnavailableError,
  fitEmbedding,
  jobEmbeddingText,
  l2Normalize,
} from "../../src/services/jobs/embeddings.js";

function vector(length: number): number[] {
  return Array.from({ length }, (_, index) => index + 1);
}

describe("embeddings", () => {
  it("normalizes to unit length", () => {
    const normalized = l2Normalize([3, 4]);
    assert.deepEqual(normalized, [0.6, 0.8]);
  });

  it("rejects a vector with no direction", () => {
    assert.throws(() => l2Normalize([0, 0]), EmbeddingUnavailableError);
  });

  it("truncates the provider's 3072 dimensions to the stored width", () => {
    const fitted = fitEmbedding(vector(3072));
    assert.equal(fitted.length, EMBEDDING_DIMENSIONS);
    // Truncation happens before normalization, so the result is unit length.
    const norm = Math.sqrt(fitted.reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9);
  });

  it("rejects a vector narrower than the column", () => {
    assert.throws(() => fitEmbedding(vector(768)), EmbeddingUnavailableError);
  });

  it("embeds the same surface the keyword vector indexes", () => {
    const text = jobEmbeddingText({
      title: "Mpishi wa pilau",
      description: "Weekend only",
      area: "Mbezi",
      skills: ["kupika", "pilau"],
    });
    assert.equal(text, "Mpishi wa pilau\nWeekend only\nMbezi\nkupika\npilau");
  });

  it("skips missing parts instead of embedding the word null", () => {
    const text = jobEmbeddingText({
      title: "Dereva",
      description: null,
      area: null,
      skills: null,
    });
    assert.equal(text, "Dereva");
  });
});

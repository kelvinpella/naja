import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import { backfillJobEmbeddings } from "../../src/services/jobs/backfill-embeddings.js";

type FakeRow = {
  id: string;
  title: string | null;
  description: string | null;
  area: string | null;
  skills: string[] | null;
  embedding: number[] | null;
};

function row(index: number): FakeRow {
  return {
    id: `job-${index}`,
    title: `Kazi ${index}`,
    description: "Maelezo",
    area: "Mbezi",
    skills: null,
    embedding: null,
  };
}

function fakeClient(
  rows: FakeRow[],
  opts: { denyUpdates?: boolean; ignoreUpdates?: boolean } = {},
) {
  let updateCalls = 0;
  let selectCalls = 0;

  const client = {
    from: () => ({
      select: () => {
        selectCalls += 1;
        const builder = {
          is: () => builder,
          order: () => builder,
          limit: async (limit: number) => ({
            data: rows.filter((row) => row.embedding === null).slice(0, limit),
            error: null,
          }),
        };
        return builder;
      },
      update: (value: { embedding: number[] }) => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            updateCalls += 1;
            if (opts.denyUpdates) return { data: [], error: null };
            const target = rows.find((row) => row.id === id);
            if (!target) return { data: [], error: null };
            // A client that acknowledges the update but never persists it
            // reproduces the silent RLS no-op this code has to catch.
            if (!opts.ignoreUpdates) target.embedding = value.embedding;
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  return {
    client,
    rows,
    updateCalls: () => updateCalls,
    selectCalls: () => selectCalls,
  };
}

const embed = async (texts: string[]) => texts.map(() => [0.1, 0.2]);

describe("backfillJobEmbeddings", () => {
  it("embeds every Job missing a vector and stops", async () => {
    const { client, rows, updateCalls } = fakeClient([row(1), row(2)]);
    const pauses: number[] = [];

    const embedded = await backfillJobEmbeddings({
      client,
      embed,
      pause: async (ms) => {
        pauses.push(ms);
      },
      log: () => {},
    });

    assert.equal(embedded, 2);
    assert.equal(updateCalls(), 2);
    assert.deepEqual(
      rows.map((row) => row.embedding),
      [
        [0.1, 0.2],
        [0.1, 0.2],
      ],
    );
    assert.equal(pauses.length, 1);
  });

  it("returns zero without calling the provider when nothing is missing", async () => {
    const { client, updateCalls } = fakeClient([]);
    let embeddedTexts = 0;

    const embedded = await backfillJobEmbeddings({
      client,
      embed: async (texts) => {
        embeddedTexts += texts.length;
        return [];
      },
      pause: async () => {},
      log: () => {},
    });

    assert.equal(embedded, 0);
    assert.equal(embeddedTexts, 0);
    assert.equal(updateCalls(), 0);
  });

  it("fails at the first update RLS turns into a no-op", async () => {
    const { client, updateCalls } = fakeClient([row(1)], {
      denyUpdates: true,
    });
    let embedCalls = 0;

    await assert.rejects(
      backfillJobEmbeddings({
        client,
        embed: async (texts) => {
          embedCalls += 1;
          return texts.map(() => [1]);
        },
        pause: async () => {},
        log: () => {},
      }),
      /SUPABASE_SERVICE_ROLE_KEY/,
    );

    assert.equal(embedCalls, 1);
    assert.equal(updateCalls(), 1);
  });

  it("fails instead of re-embedding a batch that was read again", async () => {
    const { client } = fakeClient([row(1)], { ignoreUpdates: true });
    let embedCalls = 0;

    await assert.rejects(
      backfillJobEmbeddings({
        client,
        embed: async (texts) => {
          embedCalls += 1;
          return texts.map(() => [1]);
        },
        pause: async () => {},
        log: () => {},
      }),
      /was read again after its embedding was stored/,
    );

    assert.equal(embedCalls, 1);
  });
});

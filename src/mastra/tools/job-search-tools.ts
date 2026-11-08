import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  listRecentJobs,
  searchJobsHybrid,
} from "../../services/jobs/job-repository.js";
import type { JobListing } from "../../services/jobs/job-types.js";
import { SENDER_PHONE_CONTEXT_KEY } from "../request-context-keys.js";

/** What both tools hand back to the search agent. */
export type JobToolResult =
  | { kind: "results"; jobs: JobListing[]; hasMore: boolean }
  // The query could not be embedded or the search failed, so nothing ran.
  // The Person-facing recovery is the same either way: offer the recent Jobs.
  | { kind: "unavailable" };

function senderPhone(context: {
  requestContext?: { get: (key: string) => unknown };
}): string | null {
  const value = context.requestContext?.get(SENDER_PHONE_CONTEXT_KEY);
  return typeof value === "string" && value.trim() ? value : null;
}

export const searchJobsTool = createTool({
  id: "search-jobs",
  description:
    "Search published Jobs for what a Person needs. Pass the Person's own words as query, and the job terms their need would be written as in both Swahili and English. Runs keyword search in both languages plus semantic search, and returns the best matches.",
  inputSchema: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe(
        "The Person's own words, unchanged — what they said they are looking for.",
      ),
    keywords: z
      .object({
        swahili: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe(
            "One to five Swahili job terms, e.g. [\"mpishi\", \"kupika\"].",
          ),
        english: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe(
            "The same need in English job terms, e.g. [\"cook\", \"cooking\"].",
          ),
      })
      .describe(
        "The same need as search terms in both languages. Job terms, never sentences.",
      ),
  }),
  execute: async (input, context): Promise<JobToolResult> => {
    try {
      const outcome = await searchJobsHybrid({
        query: input.query,
        keywords: input.keywords,
        excludePhone: senderPhone(context),
      });
      if (outcome.kind === "unavailable") return { kind: "unavailable" };
      return {
        kind: "results",
        jobs: outcome.jobs,
        hasMore: outcome.hasMore,
      };
    } catch {
      // A failed RPC and a failed embedding both mean "no search happened";
      // the Person is offered the recent Jobs instead of an error.
      return { kind: "unavailable" };
    }
  },
});

export const listRecentJobsTool = createTool({
  id: "list-recent-jobs",
  description:
    "List the newest published Jobs, newest first. Use it when the Person wants to see what has been published recently rather than something specific.",
  inputSchema: z.object({}),
  execute: async (_input, context): Promise<JobToolResult> => {
    try {
      const page = await listRecentJobs(0, {
        excludePhone: senderPhone(context),
      });
      return { kind: "results", jobs: page.jobs, hasMore: page.hasMore };
    } catch {
      return { kind: "unavailable" };
    }
  },
});

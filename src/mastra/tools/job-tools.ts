import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { jobDetailText } from "../../services/jobs/job-cards.js";
import { getJobById } from "../../services/jobs/job-repository.js";

/**
 * The detail a carousel card opens. Reading one Job is a lookup, not a search,
 * so it is a direct tool on Naja instead of another delegation (ADR 0010).
 */
export const getJobTool = createTool({
  id: "get-job",
  description:
    "Fetch one published Job by the id a tapped card carried. Returns a ready-to-send detail body plus the Job's fields.",
  inputSchema: z.object({
    id: z
      .string()
      .trim()
      .min(1)
      .describe("The id after `job_detail:` in the tapped message."),
  }),
  execute: async ({ id }) => {
    try {
      const job = await getJobById(id);
      if (!job) return { found: false as const };
      return {
        found: true as const,
        // The image URL is for cards, not for the model to repeat.
        body: jobDetailText(job),
        title: job.title,
        area: job.area,
        budget: job.budget,
        description: job.description,
        createdAt: job.createdAt,
      };
    } catch {
      return { found: false as const };
    }
  },
});

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { jobApplyText, jobDetailText } from "../../services/jobs/job-cards.js";
import {
  getJobById,
  getJobPosterContact,
} from "../../services/jobs/job-repository.js";

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

/**
 * The `Omba` tap. Applying is opening a conversation with the poster, so the
 * tool returns their number rather than storing anything: the old staged reply
 * did exactly this, and there is still no application record or notification.
 */
export const applyForJobTool = createTool({
  id: "apply-for-job",
  description:
    "Answer a tapped `Omba` button by returning the poster's phone number for that Job, ready to send. Returns { found: false } when the Job is gone.",
  inputSchema: z.object({
    id: z
      .string()
      .trim()
      .min(1)
      .describe("The id after `job_apply:` in the tapped message."),
  }),
  execute: async ({ id }) => {
    try {
      const job = await getJobPosterContact(id);
      if (!job) return { found: false as const };
      return {
        found: true as const,
        body: jobApplyText(job),
        title: job.title,
        posterPhone: job.posterPhone,
      };
    } catch {
      return { found: false as const };
    }
  },
});

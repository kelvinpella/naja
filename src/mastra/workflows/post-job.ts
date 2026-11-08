import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import {
  downloadPostJobImage,
  deletePostJobImage,
  uploadPostJobImage,
} from "../../services/jobs/job-image-storage.js";
import { embedJobTextOrNull } from "../../services/jobs/embeddings.js";
import { publishJob } from "../../services/jobs/job-repository.js";
import { moderatePosting } from "../../services/jobs/moderation.js";

const postingJobSchema = z.object({
  eventId: z.string(),
  personKey: z.string(),
  phoneNumberId: z.string(),
  recipient: z.string(),
  recipientType: z.enum(["phone", "bsuid"]),
  senderPhone: z.string().optional(),
  details: z.object({
    title: z.string(),
    description: z.string(),
    area: z.string(),
    budget: z.number(),
  }),
  media: z
    .object({
      id: z.unknown().optional(),
      media_id: z.unknown().optional(),
      // Meta's snake_case and Kapso's camelCase both arrive here.
      mime_type: z.unknown().optional(),
      mimeType: z.unknown().optional(),
      file_name: z.unknown().optional(),
      fileName: z.unknown().optional(),
    })
    .nullable(),
});

// What the Posting learns on the way: the verdict, then the row it produced.
// The Submission itself is the step input, so it never has to be copied here.
const postingStateSchema = z.object({
  eventId: z.string(),
  personKey: z.string(),
  title: z.string(),
  flagged: z.boolean().optional(),
  flagReason: z.string().optional(),
  jobId: z.string().optional(),
});

const publishOutputSchema = z.object({
  jobId: z.string(),
  title: z.string(),
  // False when the provider failed: the Job is live but only keyword-searchable
  // until `npm run jobs:embed` fills the vector in (ADR 0008).
  embedded: z.boolean(),
});

function kapsoApiKey(): string {
  const key = process.env["KAPSO_API_KEY"]?.trim();
  if (!key) throw new Error("KAPSO_API_KEY is required to publish a Posting");
  return key;
}

const moderateStep = createStep({
  id: "moderate",
  inputSchema: postingJobSchema,
  outputSchema: postingJobSchema,
  stateSchema: postingStateSchema,
  execute: async ({ inputData, state, setState, abortSignal }) => {
    const verdict = await moderatePosting({
      details: inputData.details,
      // Fetched only if the moderator asks for it: today's placeholder never
      // does, so an image is downloaded once, by publish.
      loadPhoto: async () =>
        inputData.media
          ? (
              await downloadPostJobImage(inputData.media, {
                apiKey: kapsoApiKey(),
                phoneNumberId: inputData.phoneNumberId,
                signal: abortSignal,
              })
            ).bytes
          : null,
    });

    await setState({
      ...state,
      flagged: verdict.flagged,
      flagReason: verdict.reason,
    });

    // Flagged Postings have no path yet: the Person is not told, and nothing
    // is stored. See the moderation issue before wiring a real model here.
    if (verdict.flagged) {
      throw new Error(
        `Posting flagged by moderation: ${verdict.reason ?? "no reason given"}`,
      );
    }

    return inputData;
  },
});

const publishStep = createStep({
  id: "publish",
  inputSchema: postingJobSchema,
  outputSchema: publishOutputSchema,
  stateSchema: postingStateSchema,
  execute: async ({ inputData, state, setState, abortSignal }) => {
    let jobImage: string | null = null;
    let imagePath: string | null = null;

    if (inputData.media) {
      const photo = await downloadPostJobImage(inputData.media, {
        apiKey: kapsoApiKey(),
        phoneNumberId: inputData.phoneNumberId,
        signal: abortSignal,
      });
      const uploaded = await uploadPostJobImage(photo.bytes, photo.contentType, {
        personKey: inputData.personKey,
        userPhone: inputData.senderPhone,
      });
      jobImage = uploaded.url;
      imagePath = uploaded.path;
    }

    const digits = (inputData.senderPhone ?? "").replace(/\D/g, "");
    const details = {
      title: inputData.details.title.slice(0, 80),
      description: inputData.details.description.slice(0, 500),
      area: inputData.details.area.slice(0, 80),
    };
    // One write: the vector rides on the insert. A failure returns null, and
    // publishing still happens — search just cannot see it semantically yet.
    const embedding = await embedJobTextOrNull(details);

    let created;
    try {
      created = await publishJob({
        ...details,
        budget: inputData.details.budget,
        jobImage,
        // jobs.created_by_phone has an E.164 check constraint; senderPhone is
        // digits-only, so the leading + goes back on.
        posterPhone: digits ? `+${digits}` : null,
        embedding,
      });
    } catch (error) {
      if (imagePath) await deletePostJobImage(imagePath);
      throw error;
    }

    await setState({ ...state, jobId: created.id });
    return {
      jobId: created.id,
      title: created.title ?? inputData.details.title,
      embedded: embedding !== null,
    };
  },
});

/**
 * One Posting: moderate, then publish. Nothing here talks to WhatsApp — the
 * messages and Memory notes belong to the worker, so a send that fails can
 * never re-run the insert (ADR 0007). Registered in `src/mastra/index.ts`, so
 * each run is visible in Studio.
 */
export const postJobWorkflow = createWorkflow({
  id: "post-job",
  inputSchema: postingJobSchema,
  outputSchema: publishOutputSchema,
  stateSchema: postingStateSchema,
})
  .then(moderateStep)
  .then(publishStep)
  .commit();

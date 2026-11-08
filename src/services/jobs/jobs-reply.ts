import type { FastifyBaseLogger } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsappReply } from "../whatsapp-reply-contract.js";
import { buildJobCards } from "./job-cards.js";
import { getJobsByIds } from "./job-repository.js";

/**
 * Turns the model's `jobs` reply into a carousel built from the database.
 * The model names the Jobs; the rows, images and Meta-sized text come from
 * here. Nothing is rendered from model output directly, so a hallucinated id
 * simply does not appear.
 */
export async function resolveJobsReply(
  reply: WhatsappReply,
  logger: FastifyBaseLogger,
  client?: SupabaseClient,
): Promise<WhatsappReply> {
  if (reply.kind !== "jobs") return reply;

  try {
    const jobs = await getJobsByIds(reply.jobIds, client);
    if (jobs.length === 0) {
      logger.warn(
        { jobIds: reply.jobIds },
        "Jobs reply named no published Jobs; sending its body as text",
      );
      return { kind: "text", body: reply.body };
    }
    return { kind: "carousel", body: reply.body, cards: buildJobCards(jobs) };
  } catch (error) {
    // A carousel that cannot be built must not swallow the reply: the body is
    // still a real message, and the Turn has already spent its model call.
    logger.error(
      { err: error, jobIds: reply.jobIds },
      "Could not load the Jobs for a carousel; sending the body as text",
    );
    return { kind: "text", body: reply.body };
  }
}

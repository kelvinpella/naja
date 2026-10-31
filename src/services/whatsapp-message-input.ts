import type { WhatsappIncomingMessageJob } from "../queues/whatsapp-events.js";

function withCaption(placeholder: string, caption?: string): string {
  return caption ? `${placeholder} caption: "${caption}"` : placeholder;
}

/**
 * Turns an inbound message into the text the model sees. Media cannot be
 * opened this round, so it arrives as an explicit placeholder: the agent is
 * instructed to say it cannot read it rather than guess at the contents.
 */
export function toAgentInput(job: WhatsappIncomingMessageJob): string {
  const text = job.text?.trim();
  if (text) return text;

  const caption = job.caption?.trim() || undefined;

  switch (job.messageType) {
    case "image":
      return withCaption("[image]", caption);
    case "audio":
      return "[voice note]";
    case "video":
      return withCaption("[video]", caption);
    case "document":
      return withCaption("[document]", caption);
    case "sticker":
      return "[sticker]";
    case "location":
      return job.location
        ? `[location] ${job.location.latitude}, ${job.location.longitude}`
        : "[location]";
    case "contacts":
      return "[contact card]";
    case "reaction":
      return "[reaction to an earlier message]";
    case "interactive":
      return job.interactiveTitle
        ? `[tapped option] ${job.interactiveTitle}`
        : "[tapped option]";
    case "button":
      return job.interactiveTitle
        ? `[tapped option] ${job.interactiveTitle}`
        : "[tapped option]";
    default:
      return job.messageType
        ? `[${job.messageType} message]`
        : "[message with no text]";
  }
}

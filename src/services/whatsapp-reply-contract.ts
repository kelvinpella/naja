import { z } from "zod";

// Meta caps interactive messages far tighter than plain text, so the schema
// below encodes those caps rather than letting a reply fail at send time. A
// Turn that does not fit an interactive shape degrades to one text message
// instead — never to a truncated one.
export const MAX_INTERACTIVE_BODY_LENGTH = 1024;
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE_LENGTH = 20;
export const MAX_LIST_ROWS = 10;
export const MAX_LIST_ROW_TITLE_LENGTH = 24;
export const MAX_LIST_ROW_DESCRIPTION_LENGTH = 72;
export const MAX_LIST_BUTTON_TEXT_LENGTH = 20;

const choiceId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe(
    "Stable id WhatsApp echoes back when this choice is tapped, e.g. \"tafuta\".",
  );

// Every variant carries its own when-to-use description: the schema is what
// tells the model which shape exists for which intent, so the choice is a menu
// of named shapes rather than an inference from how the text reads.
const replySchemaByKind = [
  z.object({
    kind: z
      .literal("text")
      .describe(
        "A plain text reply. Use it when the person only has to read something — an answer, an acknowledgement, a question answered in their own words.",
      ),
    body: z
      .string()
      .trim()
      .min(1)
      .describe("The message text, brief and in the person's language."),
  }),

  z.object({
    kind: z
      .literal("buttons")
      .describe(
        "Tappable buttons. Use it when the next step is one of at most three things — an Option, a yes/no, a kind of work with few answers.",
      ),
    body: z
      .string()
      .trim()
      .min(1)
      .max(MAX_INTERACTIVE_BODY_LENGTH)
      .describe(
        "The message shown above the buttons. It must stand on its own: if the buttons cannot be shown, only this and the button labels are sent.",
      ),
    buttons: z
      .array(
        z.object({
          id: choiceId,
          title: z
            .string()
            .trim()
            .min(1)
            .max(MAX_BUTTON_TITLE_LENGTH)
            .describe("Button label of at most 20 characters."),
        }),
      )
      .min(1)
      .max(MAX_BUTTONS)
      .describe("One to three buttons."),
  }),

  z.object({
    kind: z
      .literal("list")
      .describe(
        "A tappable list opened by one button. Use it when there are four to ten choices — kinds of work, a set of areas.",
      ),
    body: z
      .string()
      .trim()
      .min(1)
      .max(MAX_INTERACTIVE_BODY_LENGTH)
      .describe("The message shown above the list button, readable on its own."),
    buttonText: z
      .string()
      .trim()
      .min(1)
      .max(MAX_LIST_BUTTON_TEXT_LENGTH)
      .describe("Label on the button that opens the list, e.g. \"Chagua\"."),
    rows: z
      .array(
        z.object({
          id: choiceId,
          title: z
            .string()
            .trim()
            .min(1)
            .max(MAX_LIST_ROW_TITLE_LENGTH)
            .describe("Row label of at most 24 characters."),
          description: z
            .string()
            .trim()
            .min(1)
            .max(MAX_LIST_ROW_DESCRIPTION_LENGTH)
            .optional()
            .describe("Optional one-line detail under the row label."),
        }),
      )
      .min(1)
      .max(MAX_LIST_ROWS)
      .describe("One to ten rows."),
  }),

  z.object({
    kind: z
      .literal("cta_url")
      .describe(
        "A reply with one link button. Use it when the person should open a page — terms, a site.",
      ),
    body: z
      .string()
      .trim()
      .min(1)
      .max(MAX_INTERACTIVE_BODY_LENGTH)
      .describe("The message shown above the link button, readable on its own."),
    displayText: z
      .string()
      .trim()
      .min(1)
      .max(MAX_BUTTON_TITLE_LENGTH)
      .describe("Label on the link button of at most 20 characters."),
    url: z.url().describe("Absolute https URL the button opens."),
  }),

  z.object({
    kind: z
      .literal("location_request")
      .describe(
        "A reply that asks for the person's location with a share-location button. Use it when the area is what you need next.",
      ),
    body: z
      .string()
      .trim()
      .min(1)
      .max(MAX_INTERACTIVE_BODY_LENGTH)
      .describe(
        "The message that asks for the location. It must ask on its own: if the button cannot be shown, only this is sent.",
      ),
    buttonText: z
      .string()
      .trim()
      .min(1)
      .max(MAX_BUTTON_TITLE_LENGTH)
      .optional()
      .describe(
        "Label on the share-location button. Leave it out for the Swahili default.",
      ),
  }),
] as const;

export const replySchema = z.discriminatedUnion("kind", replySchemaByKind);

export type WhatsappReply = z.infer<typeof replySchema>;

const FALLBACK_LOCATION_BUTTON = "Tuma eneo";

function withNumberedChoices(body: string, titles: string[]): string {
  const choices = titles
    .map((title, index) => `${index + 1}. ${title}`)
    .join("\n");
  return `${body}\n\n${choices}`;
}

/**
 * The message a reply becomes when it is sent as plain text: interactive
 * messages cannot be shown, so their choices are numbered in the body exactly
 * as they were before buttons existed. A typed "1" and a tap mean the same.
 */
export function renderReplyText(reply: WhatsappReply): string {
  switch (reply.kind) {
    case "text":
      return reply.body;
    case "buttons":
      return withNumberedChoices(
        reply.body,
        reply.buttons.map((button) => button.title),
      );
    case "list":
      return withNumberedChoices(
        reply.body,
        reply.rows.map((row) => row.title),
      );
    case "cta_url":
      return `${reply.body}\n\n${reply.url}`;
    case "location_request":
      return reply.body;
  }
}

export function locationRequestButton(reply: { buttonText?: string }): string {
  return reply.buttonText ?? FALLBACK_LOCATION_BUTTON;
}

function stripCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/** Whether the text looks like a serialized reply envelope rather than a message. */
export function looksLikeReplyEnvelope(text: string): boolean {
  return stripCodeFence(text.trim()).startsWith("{");
}

/**
 * Recovers a reply from text when the model answered in prose or in JSON
 * without the structured pass catching it. Returns `null` when the text is a
 * broken envelope — sending that JSON to a person would be worse than the
 * fallback apology.
 */
export function replyFromText(text: string): WhatsappReply | null {
  const candidate = stripCodeFence(text.trim());
  if (!candidate.startsWith("{")) return null;

  try {
    const parsed = replySchema.safeParse(JSON.parse(candidate));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Picks the reply a Turn actually sends: the structured object when the model
 * produced one, the model's own text when it answered in prose or in JSON that
 * only nearly matched the schema, and nothing when the text is a broken
 * envelope — a person should never receive raw JSON.
 */
export function toWhatsappReply(
  candidate: unknown,
  fallbackText?: string,
): WhatsappReply | null {
  const parsed = replySchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const text = fallbackText?.trim() ?? "";
  if (!text) return null;

  const recovered = replyFromText(text);
  if (recovered) return recovered;

  return looksLikeReplyEnvelope(text) ? null : { kind: "text", body: text };
}

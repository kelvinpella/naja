import type { PostJobFields } from "../flows/post-job-flow.js";

export type ModerationVerdict = {
  flagged: boolean;
  // Stored with the Posting so the Person can be told why, and so a flagged
  // Job can be found later without re-running the check.
  reason?: string;
};

export type ModerationInput = {
  details: PostJobFields;
  /**
   * Downloads the Submitted photo, when there is one. A function rather than
   * bytes so a moderator that only reads text never pays for the download.
   */
  loadPhoto: () => Promise<Uint8Array | null>;
};

/**
 * Placeholder: every Posting passes.
 *
 * The real check is OpenAI's omni-moderation model over the text fields and
 * the photo bytes, and it is not implemented yet. When it is, a flagged
 * Posting must not reach `publish`: the Person is told, and the Form is
 * re-sent prefilled. See the moderation issue.
 */
export async function moderatePosting(
  input: ModerationInput,
): Promise<ModerationVerdict> {
  void input;
  return { flagged: false };
}

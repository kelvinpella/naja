/**
 * The Person's phone number, carried from the worker into the Turn so the
 * search tools can exclude the Jobs that Person posted themselves. A BSUID-only
 * Person has no number, and then nothing is excluded.
 */
export const SENDER_PHONE_CONTEXT_KEY = "senderPhone";

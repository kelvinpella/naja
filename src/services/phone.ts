// Shared Phone seam: one normalize used by the event mapper, the Jobs
// module, and conversation handlers. Digits-only in flight, E.164 at rest.

/** Digits-only phone in flight (mapper → handlers → Jobs). */
export type PhoneDigits = string;
/** E.164 phone at rest (jobs.created_by_phone). */
export type E164Phone = string;

export function normalizePhoneDigits(phone: string | null | undefined): PhoneDigits {
  return (phone ?? "").replace(/\D/g, "");
}

export function toE164Phone(phone: string | null | undefined): E164Phone | null {
  const digits = normalizePhoneDigits(phone);
  return digits ? `+${digits}` : null;
}

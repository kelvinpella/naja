// AzamPay sandbox wiring (issue #24): Omba tap -> MNO checkout STK push.
// Raw fetch on purpose: no official Node SDK exists and the community
// packages are unvetted (see docs/research/tanzania-mobile-money.md §3.1).
// Docs: https://developerdocs.azampay.co.tz/tanzania/checkout-api#mno-checkout
// Auth: POST {authBase}/AppRegistration/GenerateToken {appName, clientId,
//   clientSecret} -> { data: { accessToken, expire } }.
// Checkout: POST {checkoutBase}/azampay/mno/checkout with Bearer token.

export type AzamPayProvider =
  | "Airtel"
  | "Tigo"
  | "Halopesa"
  | "Azampesa"
  | "Mpesa";

export type AzamPayConfig = {
  appName: string;
  clientId: string;
  clientSecret: string;
  authBaseUrl: string;
  checkoutBaseUrl: string;
  testAmount: string;
};

export const AZAMPAY_SANDBOX_AUTH_BASE_URL =
  "https://authenticator-sandbox.azampay.co.tz";
export const AZAMPAY_SANDBOX_CHECKOUT_BASE_URL =
  "https://sandbox.azampay.co.tz";
const DEFAULT_TEST_AMOUNT = "1000";

function requiredEnv(
  env: NodeJS.ProcessEnv,
  key: string,
): string | null {
  const value = (env[key] ?? "").trim();
  return value ? value : null;
}

/** Null when sandbox creds are missing (caller sends a fallback message). */
export function loadAzamPayConfig(
  env: NodeJS.ProcessEnv = process.env,
): AzamPayConfig | null {
  const appName = requiredEnv(env, "AZAMPAY_APP_NAME");
  const clientId = requiredEnv(env, "AZAMPAY_CLIENT_ID");
  const clientSecret = requiredEnv(env, "AZAMPAY_CLIENT_SECRET");
  if (!appName || !clientId || !clientSecret) return null;
  const stripSlash = (url: string): string => url.replace(/\/+$/, "");
  return {
    appName,
    clientId,
    clientSecret,
    authBaseUrl: stripSlash(
      (env.AZAMPAY_AUTH_BASE_URL ?? "").trim() ||
        AZAMPAY_SANDBOX_AUTH_BASE_URL,
    ),
    checkoutBaseUrl: stripSlash(
      (env.AZAMPAY_CHECKOUT_BASE_URL ?? "").trim() ||
        AZAMPAY_SANDBOX_CHECKOUT_BASE_URL,
    ),
    testAmount: (env.AZAMPAY_TEST_AMOUNT ?? "").trim() || DEFAULT_TEST_AMOUNT,
  };
}

/** Any TZ number -> 255-prefixed digits AzamPay expects, or null. */
export function toAzamPayMsisdn(
  phone: string | null | undefined,
): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0")
    ? `255${digits.slice(1)}`
    : digits.startsWith("255")
      ? digits
      : digits.length === 9
        ? `255${digits}`
        : digits;
  return /^255\d{9}$/.test(normalized) ? normalized : null;
}

export function detectAzamPayProvider(msisdn: string): AzamPayProvider {
  const prefix3 = msisdn.slice(0, 6);
  const start2 = msisdn.slice(0, 5);
  if (
    start2 === "25571" ||
    start2 === "25565" ||
    start2 === "25567" ||
    ["255711", "255712", "255713", "255714", "255715"].some((p) =>
      prefix3.startsWith(p),
    )
  )
    return "Tigo";
  if (start2 === "25578" || start2 === "25568") return "Airtel";
  if (start2 === "25562") return "Halopesa";
  if (start2 === "25577") return "Azampesa";
  return "Mpesa";
}

/** Caller-generated unique reference (AzamPay cap: 128 chars). */
export function buildExternalId(jobId: string, eventId: string): string {
  return `naja-${eventId}-${jobId.slice(0, 8)}`.slice(0, 128);
}

export type AzamPayCheckoutInput = {
  accountNumber: string;
  provider: AzamPayProvider;
  externalId: string;
  amount: string;
  jobId: string;
};

export type AzamPayCheckoutResult =
  | { ok: true; transactionId: string; message: string }
  | { ok: false; message: string; statusCode?: number };

type FetchFn = typeof fetch;

let cachedToken: { token: string; expiresAt: number } | null = null;

export function clearAzamPayTokenCache(): void {
  cachedToken = null;
}

async function requestAzamPayToken(
  config: AzamPayConfig,
  fetchFn: FetchFn,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const response = await fetchFn(
    `${config.authBaseUrl}/AppRegistration/GenerateToken`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appName: config.appName,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`AzamPay auth rejected the credentials (${response.status})`);
  }
  const data = (await response.json()) as {
    data?: { accessToken?: string };
  };
  const token = data?.data?.accessToken;
  if (!token) throw new Error("AzamPay auth returned no access token");
  // No documented TTL on the token response: cache briefly to avoid
  // re-authing on every Omba tap within a burst.
  cachedToken = { token, expiresAt: Date.now() + 10 * 60 * 1000 };
  return token;
}

export async function azamPayMnoCheckout(
  config: AzamPayConfig,
  input: AzamPayCheckoutInput,
  fetchFn: FetchFn = fetch,
  timeoutMs = 25_000,
): Promise<AzamPayCheckoutResult> {
  // Sandbox round trips are slow (observed ~35s): cap the whole
  // auth+checkout flow so the caller always finishes inside the worker's
  // 30s processing budget and can still reply on WhatsApp.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  const timedFetch = ((url: string, init?: RequestInit) =>
    fetchFn(url, { ...init, signal: controller.signal })) as FetchFn;
  try {
    return await azamPayMnoCheckoutInner(
      config,
      input,
      timedFetch,
      controller.signal,
    );
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, message: "AzamPay took too long to respond" };
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

async function azamPayMnoCheckoutInner(
  config: AzamPayConfig,
  input: AzamPayCheckoutInput,
  fetchFn: FetchFn,
  signal: AbortSignal,
): Promise<AzamPayCheckoutResult> {
  let token: string;
  try {
    token = await requestAzamPayToken(config, fetchFn);
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Auth failed",
    };
  }
  let response: Response;
  try {
    response = await fetchFn(
      `${config.checkoutBaseUrl}/azampay/mno/checkout`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountNumber: input.accountNumber,
          amount: input.amount,
          currency: "TZS",
          externalId: input.externalId,
          provider: input.provider,
          additionalProperties: { source: "naja-whatsapp", jobId: input.jobId },
        }),
      },
    );
  } catch {
    if (signal.aborted) throw new Error("AzamPay checkout aborted");
    return { ok: false, message: "AzamPay is unreachable right now" };
  }
  let data: {
    success?: boolean;
    transactionId?: string;
    message?: string;
    msg?: string;
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return {
      ok: false,
      message: `AzamPay returned an unreadable response (${response.status})`,
      statusCode: response.status,
    };
  }
  if (response.ok && data.success) {
    return {
      ok: true,
      transactionId: data.transactionId ?? input.externalId,
      message: data.message ?? data.msg ?? "Checkout accepted",
    };
  }
  return {
    ok: false,
    message: data.message ?? data.msg ?? "AzamPay rejected the payment request",
    statusCode: response.status,
  };
}

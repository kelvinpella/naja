import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  azamPayMnoCheckout,
  buildExternalId,
  clearAzamPayTokenCache,
  detectAzamPayProvider,
  loadAzamPayConfig,
  toAzamPayMsisdn,
  type AzamPayConfig,
} from "../../src/services/payments/azampay.js";

function config(): AzamPayConfig {
  return {
    appName: "NajaTest",
    clientId: "test-client",
    clientSecret: "test-secret",
    authBaseUrl: "https://auth.example",
    checkoutBaseUrl: "https://checkout.example",
    testAmount: "1000",
  };
}

describe("azampay sandbox wiring", () => {
  it("returns null config when credentials are missing", () => {
    assert.equal(
      loadAzamPayConfig({} as NodeJS.ProcessEnv),
      null,
    );
    assert.ok(
      loadAzamPayConfig({
        AZAMPAY_APP_NAME: "Naja",
        AZAMPAY_CLIENT_ID: "id",
        AZAMPAY_CLIENT_SECRET: "secret",
      } as NodeJS.ProcessEnv)?.testAmount === "1000",
    );
  });

  it("normalizes TZ numbers to 255 format", () => {
    assert.equal(toAzamPayMsisdn("0712345678"), "255712345678");
    assert.equal(toAzamPayMsisdn("+255712345678"), "255712345678");
    assert.equal(toAzamPayMsisdn("255712345678"), "255712345678");
    assert.equal(toAzamPayMsisdn("712345678"), "255712345678");
    assert.equal(toAzamPayMsisdn(null), null);
    assert.equal(toAzamPayMsisdn("123"), null);
  });

  it("detects the wallet provider from the prefix", () => {
    assert.equal(detectAzamPayProvider("255712345678"), "Tigo");
    assert.equal(detectAzamPayProvider("255783123456"), "Airtel");
    assert.equal(detectAzamPayProvider("255621123456"), "Halopesa");
    assert.equal(detectAzamPayProvider("255771123456"), "Azampesa");
    assert.equal(detectAzamPayProvider("255745123456"), "Mpesa");
  });

  it("builds a unique external id within the 128-char cap", () => {
    const id = buildExternalId("job-id-123", "event-abc");
    assert.ok(id.length <= 128);
    assert.ok(id.includes("event-abc"));
    assert.notEqual(
      buildExternalId("job-id-123", "event-abc"),
      buildExternalId("job-id-123", "event-def"),
    );
  });

  it("auths then posts mno/checkout with the Bearer token", async () => {
    clearAzamPayTokenCache();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (String(url).endsWith("/AppRegistration/GenerateToken")) {
        return new Response(
          JSON.stringify({ data: { accessToken: "tok-123" } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ success: true, transactionId: "txn-1", message: "ok" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await azamPayMnoCheckout(
      config(),
      {
        accountNumber: "255712345678",
        provider: "Tigo",
        externalId: "naja-test-1",
        amount: "1000",
        jobId: "job-1",
      },
      fetchFn,
    );

    assert.deepEqual(result, {
      ok: true,
      transactionId: "txn-1",
      message: "ok",
    });
    assert.equal(calls.length, 2);
    const checkout = calls[1];
    assert.ok(checkout.url.endsWith("/azampay/mno/checkout"));
    assert.equal(
      (checkout.init.headers as Record<string, string>).Authorization,
      "Bearer tok-123",
    );
    const body = JSON.parse(String(checkout.init.body)) as Record<string, unknown>;
    assert.equal(body.accountNumber, "255712345678");
    assert.equal(body.amount, "1000");
    assert.equal(body.currency, "TZS");
    assert.equal(body.provider, "Tigo");
    assert.equal(body.externalId, "naja-test-1");
  });

  it("surfaces checkout rejections as failures", async () => {
    clearAzamPayTokenCache();
    const fetchFn = (async (url: string) => {
      if (String(url).endsWith("/AppRegistration/GenerateToken")) {
        return new Response(
          JSON.stringify({ data: { accessToken: "tok-123" } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ success: false, message: "Insufficient funds" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const result = await azamPayMnoCheckout(
      config(),
      {
        accountNumber: "255712345678",
        provider: "Mpesa",
        externalId: "naja-test-2",
        amount: "1000",
        jobId: "job-1",
      },
      fetchFn,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /Insufficient funds/);
  });

  it("surfaces auth failures without calling checkout", async () => {    clearAzamPayTokenCache();
    let checkoutCalls = 0;
    const fetchFn = (async (url: string) => {
      if (String(url).endsWith("/AppRegistration/GenerateToken")) {
        return new Response("unauthorized", { status: 401 });
      }
      checkoutCalls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const result = await azamPayMnoCheckout(
      config(),
      {
        accountNumber: "255712345678",
        provider: "Mpesa",
        externalId: "naja-test-3",
        amount: "1000",
        jobId: "job-1",
      },
      fetchFn,
    );
    assert.equal(result.ok, false);
    assert.equal(checkoutCalls, 0);
  });

  it("fails fast with a timeout message when AzamPay hangs", async () => {
    clearAzamPayTokenCache();
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError")),
        );
      })) as typeof fetch;

    const result = await azamPayMnoCheckout(
      config(),
      {
        accountNumber: "255712345678",
        provider: "Mpesa",
        externalId: "naja-test-timeout",
        amount: "1000",
        jobId: "job-1",
      },
      hangingFetch,
      50,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /took too long/);
  });
});

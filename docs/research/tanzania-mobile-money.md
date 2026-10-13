# Tanzania Mobile Money Integration Research (Token Payments)

- **Date:** 2026-10-12
- **Issue:** kelvinpella/naja#17 — "Research mobile money integration for Tanzania (token payments)"
- **Context:** Naja is a Fastify + TypeScript backend (Fastify 5, BullMQ + Redis queues, Supabase). Users need to buy "tokens" for publishing/applying for jobs, paid via Tanzanian mobile money (M-Pesa Vodacom, Tigo Pesa / Mixx by Yas, Airtel Money, Halopesa).
- **Method:** Primary sources only — official provider docs pages, first-party API references, official pricing/onboarding pages. Every factual claim carries a per-claim citation URL. Secondary blog write-ups were used only as pointers, never as evidence.

## 1. Key distinction: Tanzania ≠ Kenya Daraja

- Vodacom Tanzania M-Pesa integrations use the **Vodacom/Vodafone M-Pesa OpenAPI** (`openapi.m-pesa.com` / `openapiportal.m-pesa.com`), **not** Safaricom Kenya's Daraja API. Endpoints, auth, and payload shapes are unrelated. (https://elixir-mpesa.hexdocs.pm/ElixirMpesa.html)
- Safaricom Daraja tutorials (STK push `CustomerPayBillOnline`, `ShortCode`/`CommandID` shapes) do **not** apply to Tanzanian Vodacom numbers. (https://dev.to/msnmongare/m-pesa-daraja-api-c2b-integration-guide-djn)
- Implication for Naja: ignore Kenya-targeted code samples; build against the Vodacom OpenAPI (direct) or a TZ aggregator.

## 2. Direct MNO APIs

### 2.1 Vodacom M-Pesa (Tanzania) — OpenAPI

- Exposed APIs: **C2B (Customer-to-Business), reversals, and transaction-status query**. "More will be added in due time." (https://business.m-pesa.com/developers/)
- APIs are RESTful; a Java library (`portal-sdk.jar`) is offered for session/key encryption, with a documented "develop without library file" path; code samples provided in Java and Python. No official Node.js/TypeScript SDK. (https://business.m-pesa.com/developers/)
- Auth model: developer account on the Integration Portal yields an **API Key + Public Key** in the account profile; the key can be renewed from the profile. (https://business.m-pesa.com/developers/)
- Sandbox: the portal provides a **sandbox testing environment** with reports (table/chart) per API key; go-live requires demonstrating successful transactions, then clicking "Go Live" so Vodafone M-Pesa reviews the integration. (https://business.m-pesa.com/developers/)
- Market specifics (TZ): sandbox path `/sandbox/ipg/v2/vodacomTZN/`, live path `/openapi/ipg/v2/vodacomTZN/`, country `TZN`, currency `TZS`. (https://tekmpesa.readthedocs.io/en/latest/_modules/mpesa/tanzania.html)
- C2B single-stage charge fields: `input_Amount`, `input_Country`, `input_Currency`, `input_CustomerMSISDN`, `input_ServiceProviderCode`, `input_ThirdPartyConversationID` (unique per transaction — caller-generated idempotency key), `input_TransactionReference`, `input_PurchasedItemsDesc`. Success response code `INS-0` ("Request processed successfully") with `TransactionID`. (https://tekmpesa.readthedocs.io/en/latest/_modules/mpesa/tanzania.html)
- Also supports B2C/B2B single-stage, beneficiary-name query, transaction-status query, reversal, and direct-debit mandate APIs on the same OpenAPI family. (https://elixir-mpesa.hexdocs.pm/ElixirMpesa.html)
- Business onboarding: must first register as an M-Pesa organisation, then sign up on the Open API portal and select a product; the M-Pesa team matches it against the application form and approves; developer builds + sandbox-tests, organisation does end-to-end testing, then sets the API live. Requests go via `m-pesabusiness@vodacom.co.tz` with a Key Account Manager; requires registered organisation/company with valid documentation. (https://business.m-pesa.com/vodacom-tanzania/business-onboarding-tanzania/) (https://vodacom.co.tz/business-payment)
- Fit note: direct M-Pesa covers only Vodacom. Naja would still need 3 more integrations for Tigo/Mixx, Airtel, Halopesa — 4× onboarding, 4× webhook contracts, 4× reconciliation formats.

### 2.2 Airtel Money (Tanzania) — Airtel Africa Developer Portal

- Airtel Africa provides a first-party **Developer Portal with Open APIs** letting merchants **both collect Airtel Money payments and disburse into Airtel Money wallets**; 400+ businesses were in pilot at launch. Portal built by Airtel Africa Digital Labs. (https://www.airtel.africa/assets/pdf/press-release/Airtel-Africa-Developer-Portal_ENGLISH.pdf)
- Detailed endpoint docs are **gated behind business approval** (consistent with the pattern that direct API access requires Airtel business approval). No public Node.js SDK from Airtel. (https://mctaba.com/learn/tanzania/airtel-money-api-integration-tanzania)
- Implication: direct Airtel integration is possible but slow to start; aggregators expose it faster (see §3).

### 2.3 Tigo Pesa / Mixx by Yas and Halopesa (direct)

- No public, ungated first-party developer docs were found for direct Tigo/Yas ("Mixx by Yas") or Halopesa (Viettel/Halotel) C2B APIs. Aggregator docs confirm both networks are reachable **through aggregators**: ClickPesa lists EzyPesa/HaloPesa and Mixx by Yas among payout/collection rails (https://clickpesa.com/payment-gateway/payment-and-payout-methods/ezypesa-api-integration-guide); Selcom's callback-channel table lists `AIRTELMONEY`, `HALOPESA`, `MIXXBYYAS`, `MPESA` as enabled channels (https://developer.selcom.business).
- Implication: treat direct Tigo/Halo integration as **not publicly documented**; plan to reach those wallets via an aggregator.

## 3. Aggregators operating in TZ

### 3.1 AzamPay (Tanzania-native)

- Single API covering **M-Pesa, Tigo Pesa, Airtel Money** collections (marketing page), plus AzamPesa; MNO-checkout provider enum is `Airtel | Tigo | Halopesa | Azampesa | Mpesa`. (https://azampay.com/tanzania-mobile-money-payments) (https://cdn.jsdelivr.net/npm/azampay@0.0.5/lib/shared/interfaces/base.interface.d.ts)
- Official developer docs hub with Tanzania / Rwanda / IMT APIs; contact `support@azampay.com`. (https://developerdocs.azampay.co.tz)
- MNO checkout shape (`POST /azampay/mno/checkout`): `accountNumber` (255-prefixed MSISDN), `amount`, `currency` (TZS), `provider`, `externalId` (caller unique reference ≤128 chars), optional `additionalProperties`. Also offers bank checkout (OTP), hosted `postCheckout`, `disburse` payouts, `nameLookup`, disbursement `transactionStatus`, and `partners` listing. (https://cdn.jsdelivr.net/npm/azampay@0.0.5/lib/shared/interfaces/base.interface.d.ts) (https://pub.dev/documentation/azampay/latest/)
- Auth: `appName` + `clientId` + `clientSecret` (OAuth2 token cached client-side); **sandbox vs production use different base URLs** for authenticator and checkout — mixing them is the top setup failure. (https://docs.centipidbilling.com/billing/payment-gateways/azampay)
- Callback contract: register callback URL in AzamPay portal; production callbacks carry a **callback password** that must match server-side or every callback is rejected (fail-closed); match client id when present; **dedupe repeated callbacks** for an already-recorded transaction. (https://docs.centipidbilling.com/billing/payment-gateways/azampay)
- Node.js/TypeScript: community `azampay` npm package exposes `mnoCheckout`/`bankCheckout`/`postCheckout`/`disburse`/`transactionStatus`/`nameLookup` with `env: SANDBOX|LIVE` (https://cdn.jsdelivr.net/npm/azampay@0.0.5/lib/shared/interfaces/base.interface.d.ts); fuller-featured community SDK `flexcodelabs/azampay` on GitHub (https://github.com/flexcodelabs/azampay/blob/main/README.md). No first-party official Node SDK found — verify maintenance before adopting; plain `fetch` with types is viable (repo convention prefers official SDKs, but none exists here — cf. AGENTS.md §4).
- Pricing/settlement: marketing claims "automatic settlement to bank", "same-day refunds", "real-time notifications", "99.9% success rate" (https://azampay.com/tanzania-mobile-money-payments) — **no public fee schedule found**; must request pricing during onboarding. Refund capability is same-day per AzamPay (ibid.).

### 3.2 ClickPesa (Tanzania-native, licensed gateway)

- Licensed Tanzanian payment gateway; collection rails include M-Pesa, Mixx by Yas (Tigo Pesa), Airtel Money, HaloPesa/EzyPesa; also cards, banks. (https://clickpesa.com) (https://clickpesa.com/payment-gateway/payment-and-payout-methods/ezypesa-api-integration-guide)
- Products: **USSD Push API** (send a payment prompt to the customer's wallet — the closest to "STK push" for in-app checkout), hosted checkout, BillPay control numbers, TanQR/Lipa Namba, Card API, CRDB Direct Debit, plus **Mobile/Bank Payout APIs** with number name-checking. (https://docs.clickpesa.com/home/integration-overview)
- Security: real-time webhooks, **IP whitelisting + checksum validation** on API interactions. (https://clickpesa.com/clickpesa-launches-new-payment-apis-in-tanzania)
- Docs quality: redesigned docs + **API Explorer**, SDKs/plugins listed in `ClickPesa/developers.docs` repo (Mintlify-based). (https://clickpesa.com/clickpesa-launches-new-payment-apis-in-tanzania) (https://github.com/ClickPesa/developers.docs)
- Sandbox caveat (first-party): **"ClickPesa does not provide a sandbox. All API calls run against live production. Use small amounts and the pre-KYC limits while you integrate."** (https://docs.clickpesa.com/home/integration-overview) — plan micro-amount live testing instead of a sandbox.
- Pricing: no public fee schedule found; registration described as "5 minutes" on marketing site (https://clickpesa.com) — confirm fees/settlement in sales onboarding.

### 3.3 Selcom (largest TZ aggregator)

- First-party API reference at `developers.selcommobile.com` (posts to `gw.selcommobile.com`); Checkout API supports mobile-money pull (`msisdn` mandatory when `payment_method=MOBILEMONEY`), card, order create/process/status, stored cards. (https://developers.selcommobile.com)
- Callback channels explicitly include `MPESA`, `MIXXBYYAS`, `AIRTELMONEY`, `HALOPESA` (+ banks/TTCLPesa); callbacks are HTTPS POSTs to a registered URL with caller-selected parameters; `reference_id` + `status` always present. (https://developer.selcom.business)
- Community Node SDK `node-selcom` exists with checkout/webhook docs (third-party; official docs are the source of truth). (https://selcom-developers.github.io/node-selcom)
- Sandbox: secondary comparison notes sandbox availability (https://mctaba.com/learn/tanzania/selcom-vs-clickpesa-vs-pesapal-vs-direct-api-tanzania) but the community docs state "Currently the Selcom API has no test mode" (https://selcom-developers.github.io/node-selcom) — **contradiction; must confirm with Selcom directly** before planning test strategy.

### 3.4 DPO Pay by Network (ex-DPO Group; pan-African)

- TZ country page: accepts **Tigo Pesa, Vodacom M-Pesa, Airtel Money**, cards, bank transfers; multi-currency (TZS/USD/GBP…); local offices/support in Dar es Salaam, Arusha, Zanzibar. (https://dpogroup.com/online-payments/tanzania)
- Integration via shopping-cart plugins + **APIs** (`docs.dpopay.com`), payment links/invoices sendable over **WhatsApp** — relevant to Naja's WhatsApp surface. (https://dpogroup.com/online-payments/tanzania)
- Pattern caveat: DPO's classic flow is **hosted redirect/checkout** (customer leaves to a DPO page), which fits web better than a WhatsApp-chat USSD-push flow; confirm whether a pure server-to-server push (no redirect) exists for TZ mobile money before choosing DPO for Naja.

### 3.5 Pesapal (East-Africa-wide: KE/UG/TZ/ZM)

- API 3.0 (JSON): `SubmitOrderRequest` → redirect customer to Pesapal payment page → Pesapal calls back + fires **IPN** (Instant Payment Notification) → merchant **must call `GetTransactionStatus?orderTrackingId=`** to learn the outcome. Sandbox `https://cybqa.pesapal.com/pesapalv3/...`, live `https://pay.pesapal.com/v3/...`; statuses `INVALID(0)/COMPLETED(1)/FAILED(2)/REVERSED(3)`; IPN endpoint must answer `{"orderNotificationType":"IPNCHANGE","orderTrackingId":"…","orderMerchantReference":"…","status":200}`. (https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/gettransactionstatus)
- Payment methods include cards + mobile money (M-Pesa/Airtel/MTN/Tigo family per market); plugins for WooCommerce/Shopify; single integration spans multiple EA countries. (https://www.pesapal.com/rw/business/online/api-plugins) (https://www.pesapal.com/blog/why-developers-in-kenya-uganda-and-beyond-are-choosing-pesapal-s-apis)
- Fit caveat for Naja: redirect-to-hosted-page + email-oriented order model suits e-commerce, not a WhatsApp chatbot collecting a phone number + PIN approval. Workable but higher friction than push checkout.

### 3.6 Flutterwave (pan-African)

- TZ mobile-money charge: `POST https://api.flutterwave.com/v3/charges?type=mobile_money_tanzania` with `tx_ref` (unique), `amount`, `currency: TZS`, `email`, `phone_number`, optional `network` (`Airtel|Tigo|Halopesa|Vodafone`), `fullname`, `redirect_url`, `meta`. Response is **`status: pending`** (`auth_model: MOBILEMONEY`); customer approves via provider push/PIN; completion arrives as **`charge.completed` webhook**, after which merchant must **verify the transaction server-side** before crediting. Test mode auto-authorizes after seconds. (https://developer.flutterwave.com/docs/tanzania)
- Official **Node SDK** `flutterwave-node-v3` (`flw.MobileMoney.tanzania(payload)`) documented in first-party reference. (https://github.com/Flutterwave/Flutterwave-node-v3/blob/master/documentation/collections.md)
- Webhook verification (first-party): configure a **secret hash** on the dashboard; v3 verifies `verif-hash` header equals the secret; newer docs use HMAC-SHA256 → `flutterwave-signature` header; always verify before acting, respond 200 fast, offload work to a queue. (https://developer.flutterwave.com/docs/webhooks) (https://developer.flutterwave.com/v4/docs/webhooks)
- Official pricing (Help Center): **TZ mobile money 2.5%**; local cards 4.8%, international 4.8%; transfers/payouts TZ: **TZS 500 (<40k) / 1.5% (≥40k)** + TZS 3000 bank leg where applicable; TZ MoMo charge limits **min TZS 1,000 / max TZS 500,000** per transaction. (https://flutterwave.com/ng/support/pricing/pricing-for-receiving-payment) (https://flutterwave.com/ke/support/pricing/pricing-for-transfers-and-payouts) (https://flutterwave.com/za/support/payments/flutterwave-limits)
- Settlement: international settlements within ~5 days per schedule; local settlement timelines confirmed at onboarding; fees auto-deducted pre-settlement, optionally passed to customer via dashboard "charge my customers" setting. (https://flutterwave.com/mu/support/payments/international-processing-fee-faq) (https://flutterwave.com/gb/support/pricing/how-to-pass-the-transaction-charge-to-your-customers)

## 4. Comparison table

| Provider | TZ wallet coverage | API pattern | Sandbox | Official Node/TS SDK | Webhook auth | Public TZ pricing | Best for Naja |
|---|---|---|---|---|---|---|---|
| Vodacom M-Pesa direct (OpenAPI) | M-Pesa only | Server push C2B single-stage + status query + reversal; `INS-0` = success | Yes (portal sandbox + reports) | No (Java/Python samples only) | Per portal product docs (gated) | Not public | Only if M-Pesa-only MVP + team accepts 3 more integrations later |
| Airtel direct | Airtel only | Collect + disburse Open APIs (docs gated) | Gated | No | Gated | Not public | Same fragmentation problem as M-Pesa direct |
| Tigo/Mixx + Halopesa direct | Their own nets only | No public docs found | Unknown | No | Unknown | Not public | Not viable as first integration |
| **AzamPay** | Mpesa, Tigo, Airtel, Halopesa, Azampesa | Server push `mno/checkout` + callback; disburse + nameLookup + txn status | Yes (separate sandbox base URLs) | Community only (`azampay` npm / flexcodelabs) | Callback password + client-id match, fail-closed; dedupe required | Not public; same-day refunds claimed | **Top pick #1**: TZ-native, all 4 wallets, push flow fits WhatsApp |
| **ClickPesa** | M-Pesa, Mixx/Tigo, Airtel, Halo/EzyPesa | USSD Push API + hosted + BillPay + payouts w/ name-check | **No sandbox — live micro-amount testing** | SDKs/plugins via docs repo | IP whitelist + checksum + webhooks | Not public | **Top pick #2** (alt or complement): licensed, push API, strong payout story |
| Selcom | MPESA, MIXXBYYAS, AIRTELMONEY, HALOPESA | Checkout pull/push + order status + webhooks | Contradictory (confirm directly) | Community `node-selcom` | Registered HTTPS callback URL | Not public | Strong fallback; largest network, deep local knowledge base |
| DPO Pay by Network | M-Pesa, Tigo, Airtel (+cards/banks) | Hosted redirect + plugins + payment links (WhatsApp-sendable) | Via account | Plugins/SDKs per cart | Per `docs.dpopay.com` | Not public | Good for web checkout + cards; weaker for in-chat push |
| Pesapal 3.0 | Mobile money + cards (multi-country) | Redirect → callback + IPN → mandatory `GetTransactionStatus` poll | Yes (`cybqa` vs `pay` hosts) | Samples per docs | IPN JSON ack contract | Not public | Good for multi-country later; redirect friction for WhatsApp now |
| Flutterwave | Airtel, Tigo, Halopesa, Vodafone(Vodacom) | Server push charge → `pending` → `charge.completed` webhook → verify | Yes (test mode auto-approves) | **Official `flutterwave-node-v3`** | `verif-hash` / HMAC-SHA256 signature; verify-then-queue | **Public: 2.5% MoMo TZ**; limits 1k–500k TZS | **Top pick as pan-African alt**: best docs/SDK/sandbox/pricing transparency; higher % fee |

## 5. Integration patterns (apply to any choice)

- **Charge/push, never redirect-first (for WhatsApp):** prefer server-initiated push (`AzamPay mnoCheckout`, `ClickPesa USSD Push`, `Flutterwave mobile_money_tanzania` charge). Redirect flows (Pesapal/DPO hosted pages) break the chat UX — a WhatsApp user has no browser session guarantee.
- **Caller-generated idempotency key:** always generate `externalId`/`tx_ref`/`ThirdPartyConversationID` server-side (UUID) and persist **before** calling the provider. All three first-party docs require a unique reference per transaction. (AzamPay: ≤128 chars — https://cdn.jsdelivr.net/npm/azampay@0.0.5/lib/shared/interfaces/base.interface.d.ts; M-Pesa OpenAPI: `input_ThirdPartyConversationID` unique — https://tekmpesa.readthedocs.io/en/latest/_modules/mpesa/tanzania.html; Flutterwave: `tx_ref` unique — https://developer.flutterwave.com/docs/tanzania)
- **Callback/webhook handling:** verify authenticity first (secret/checksum/signature per provider), respond 200 immediately, enqueue to BullMQ for async processing — the exact pattern Naja already uses for Zernio webhooks (`preHandler` check → enqueue → 200). (Naja: `src/routes/webhooks/zernio.ts`, `src/plugins/queue.ts`) Never credit tokens in the webhook request handler.
- **Reconciliation:** never trust the redirect/success screen or the push-accepted response (`pending` ≠ paid). Always confirm via server-side status query (`GetTransactionStatus` / `transactionstatus` / verify endpoint) and match amount + currency + reference before crediting. Pesapal mandates this ordering explicitly. (https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/gettransactionstatus)
- **Timeout/duplicate handling:** USSD prompts expire; users cancel, have insufficient funds, or enter wrong PIN; callbacks can arrive late, twice, or never. Required: (a) unique constraint on provider reference + idempotency key, (b) state machine with `pending → success|failed|expired`, (c) scheduled reconciler job (BullMQ delayed job) that status-polls `pending` payments after N minutes, (d) reversal/refund path for credited-in-error cases (M-Pesa OpenAPI exposes reversal — https://business.m-pesa.com/developers/; AzamPay claims same-day refunds — https://azampay.com/tanzania-mobile-money-payments; Flutterwave MoMo refunds 5–7 days — https://flutterwave.com/mu/support/payments/international-processing-fee-faq).

## 6. Compliance / KYC onboarding

- Tanzania payment services are regulated by the **Bank of Tanzania** under the National Payment Systems Act 2015; providers must be registered with BoT. Only banks/MNOs issue e-money (6 EMIs as of BoT 2024 report). (https://breakthroughattorneys.com/payment-systems-services) (https://www.bot.go.tz/Publications/Regular/Annual%20Report/sw/2025032515311662.pdf)
- PSP merchant onboarding consistently requires: **company registration (BRELA), TIN (TRA), bank account details**, product/risk review; budget 2–8 weeks including parallel TCRA/USSD-code steps if applicable. (https://payatlas.com/countries/tanzania-united-republic-of-tz) (https://globallawexperts.com/bank-payment-service-provider-licensing-requirements-tanzania)
- Direct MNO onboarding adds per-operator business registration + Key Account Manager review (Vodacom example: `m-pesabusiness@vodacom.co.tz`). (https://vodacom.co.tz/business-payment)
- Aggregator onboarding is lighter (single KYC covers all wallets) — a major reason to start with AzamPay/ClickPesa/Flutterwave rather than 4 direct MNO contracts.
- No public TZ fee schedules were found for AzamPay/ClickPesa/Selcom/DPO/Pesapal — request written quotes (%, flat, settlement T+X, refund cost, payout fees) during onboarding and record the decision in an ADR.

## 7. Fit with Naja's Fastify backend

- **Webhook verification:** mirror the existing Zernio pattern — custom content-type parser capturing the raw body + `preHandler` signature check — since Flutterwave HMAC verification needs the raw body and AzamPay needs its callback-password field check. Precedent: `src/routes/webhooks/zernio.ts:10-26`, `src/hooks/zernio-webhook-checks.ts`.
- **Async queue handling:** add a `payments` BullMQ queue beside `whatsappIncomingMessagesQueue` (`src/plugins/queue.ts`, `src/queues/zernio-events.ts`): webhook route verifies → enqueues `{provider, reference, payload}` → worker does verify-via-API → idempotent credit. Reuse `ZERNIO_QUEUE_JOB_OPTIONS`-style retries/backoff plus a delayed reconciliation job for `pending` payments.
- **Payment vs token-credit state machine (proposed):**
  - Tables: `payments(id UUID PK, user_phone, amount, currency=TZS, provider, provider_ref UNIQUE, idempotency_key UNIQUE, status: pending|success|failed|expired|reversed, raw_callback JSONB, created_at, resolved_at)` and `token_ledger(payment_id FK UNIQUE NULL, user_phone, tokens, reason, created_at)`.
  - Rule: **exactly one `token_ledger` row per `success` payment** (partial unique index on `payment_id WHERE payment_id IS NOT NULL`); credit happens only in the worker after server-side status verification + amount match.
  - Endpoints: `POST /payments/checkout` (auth'd; body: phone, amount/token-pack, provider) → creates `pending` + calls provider; `POST /webhooks/<provider>` (verified, 200-fast, enqueue); worker resolves + sends WhatsApp confirmation via existing Zernio queue.
- **Secrets:** provider keys (client secret, callback password, secret hash) in env/secret store, never in repo; separate sandbox vs production base URLs as env pairs (AzamPay's top failure mode — https://docs.centipidbilling.com/billing/payment-gateways/azampay).

## 8. Failure modes & UX implications (WhatsApp-first)

| Failure | What happens | UX implication for Naja |
|---|---|---|
| Prompt expired (user didn't enter PIN in time) | Provider returns timeout / callback `failed` or nothing | WhatsApp message: "Muda umeisha — tuma *LIPA* ili kupokea ombi jipya." Keep `pending` briefly, then mark `expired`; one-tap retry reuses a **new** idempotency key linked to the same order. |
| User cancels / wrong PIN | `failed` callback | Message the reason in Swahili; offer retry or different wallet; do not auto-retry pushes (each push costs/confuses). |
| Insufficient funds | `failed` (provider-specific code) | Tell the exact cause + amount; suggest smaller token pack. |
| Duplicate callback / double push | Same reference delivered twice | Dedupe on `provider_ref`/idempotency unique constraint; credit once; log and ack 200. |
| Missing callback (user paid, callback lost) | `pending` forever | Delayed reconciler polls status API; on `success`, credit + notify late ("Malipo yamethibitishwa ✅"). Never tell the user "failed" until reconciler confirms. |
| Amount mismatch | Paid ≠ expected | Do not credit; flag for manual review; message user to contact support with reference. |
| Network/provider outage | Charge API errors | Fail gracefully, keep order `pending`, suggest trying another wallet (aggregator advantage: switch `provider` field). |
| Sandbox-vs-live misconfig | Charges hit wrong env | Separate env configs + startup assertion (fail fast if sandbox URL in production). |

## 9. Recommendation

1. **First integration: AzamPay** — TZ-native, covers all four required wallets (incl. Halopesa) in one push-checkout API, sandbox with separate base URLs, callback-password verification, same-day refunds claimed, TZ support presence. Accept the trade-off: only community Node SDKs, no public pricing (get a written quote). Prototype with `fetch` + Zod-validated types rather than adopting an unvetted community SDK as a core dependency.
2. **Second (in parallel for evaluation, ship one): ClickPesa** — licensed TZ gateway with an explicit USSD-Push API, checksum + IP-whitelist security, payout/name-check APIs useful later for worker payouts; but **no sandbox** (live micro-amount testing only), so keep it as the fallback/alternative quote.
- **Do not start with:** 4× direct MNO integrations (4× KYC, 4× contracts, gated docs for 3 of 4); Pesapal/DPO redirect flows (wrong UX for WhatsApp); Flutterwave as sole provider (excellent docs/SDK/sandbox and transparent 2.5% pricing, but higher fee and non-TZ settlement path — strong candidate only if Naja expands pan-Africa or needs cards).
- **Next steps:** (a) request sandbox credentials + written fee/settlement terms from AzamPay and ClickPesa; (b) confirm Selcom test-mode status only if both stall; (c) record the pick + fee schedule in `docs/adr/`; (d) implement the §7 state machine behind a provider interface so the second aggregator plugs in without touching token-credit logic.

## 10. Open questions (for onboarding calls)

- Exact per-wallet fee %, flat minimums, VAT treatment, settlement T+X and minimum payout, refund cost/window — for AzamPay and ClickPesa (nothing public found).
- AzamPay: Halopesa push reliability vs M-Pesa/Tigo; callback retry count/window; status-query rate limits.
- ClickPesa: USSD-push expiry window per wallet; pre-KYC transaction limits for live testing; checksum algorithm + IP ranges for allowlisting.
- Both: production go-live checklist and average approval timeline for a WhatsApp (non-web) merchant.

## Sources

- Vodacom M-Pesa developer overview, auth, sandbox, go-live: https://business.m-pesa.com/developers/
- Vodacom Tanzania business onboarding: https://business.m-pesa.com/vodacom-tanzania/business-onboarding-tanzania/
- Vodacom M-Pesa business account (C2B requirements): https://vodacom.co.tz/business-payment
- Vodacom OpenAPI TZ paths/fields (community SDK mirroring official spec): https://tekmpesa.readthedocs.io/en/latest/_modules/mpesa/tanzania.html
- Vodacom OpenAPI endpoint family + TZ≠Kenya warning: https://elixir-mpesa.hexdocs.pm/ElixirMpesa.html
- Airtel Africa Developer Portal (collect + disburse Open APIs): https://www.airtel.africa/assets/pdf/press-release/Airtel-Africa-Developer-Portal_ENGLISH.pdf
- AzamPay TZ coverage + settlement/refund claims: https://azampay.com/tanzania-mobile-money-payments
- AzamPay official developer docs hub: https://developerdocs.azampay.co.tz
- AzamPay MNO-checkout shape + provider enum: https://cdn.jsdelivr.net/npm/azampay@0.0.5/lib/shared/interfaces/base.interface.d.ts
- AzamPay endpoint catalogue (mnoCheckout/disburse/status): https://pub.dev/documentation/azampay/latest/
- AzamPay auth/callback/env setup: https://docs.centipidbilling.com/billing/payment-gateways/azampay
- AzamPay community Node SDK: https://github.com/flexcodelabs/azampay/blob/main/README.md
- ClickPesa integration overview (USSD Push, BillPay, TanQR, payouts; no-sandbox notice): https://docs.clickpesa.com/home/integration-overview
- ClickPesa API launch (webhooks, IP whitelist, checksum): https://clickpesa.com/clickpesa-launches-new-payment-apis-in-tanzania
- ClickPesa docs repo (SDKs/plugins): https://github.com/ClickPesa/developers.docs
- ClickPesa home (licensed gateway, rails, 5-min registration claim): https://clickpesa.com
- ClickPesa Halo/EzyPesa + Mixx rails: https://clickpesa.com/payment-gateway/payment-and-payout-methods/ezypesa-api-integration-guide
- Selcom API reference (checkout pull): https://developers.selcommobile.com
- Selcom callback channels incl. HALOPESA/MIXXBYYAS/MPESA/AIRTELMONEY: https://developer.selcom.business
- Selcom community Node docs (no-test-mode note): https://selcom-developers.github.io/node-selcom
- DPO Pay Tanzania (rails, offices, WhatsApp payment links, API docs link): https://dpogroup.com/online-payments/tanzania
- Pesapal GetTransactionStatus + IPN contract + hosts: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/gettransactionstatus
- Pesapal API/plugins overview: https://www.pesapal.com/rw/business/online/api-plugins
- Flutterwave TZ mobile-money charge + pending→webhook flow: https://developer.flutterwave.com/docs/tanzania
- Flutterwave Node SDK (TZ MoMo): https://github.com/Flutterwave/Flutterwave-node-v3/blob/master/documentation/collections.md
- Flutterwave webhook verification (v3 + v4): https://developer.flutterwave.com/docs/webhooks and https://developer.flutterwave.com/v4/docs/webhooks
- Flutterwave TZ pricing (2.5% MoMo): https://flutterwave.com/ng/support/pricing/pricing-for-receiving-payment
- Flutterwave TZ transfer pricing: https://flutterwave.com/ke/support/pricing/pricing-for-transfers-and-payouts
- Flutterwave TZ MoMo limits (1k–500k TZS): https://flutterwave.com/za/support/payments/flutterwave-limits
- Flutterwave refund timelines: https://flutterwave.com/mu/support/payments/international-processing-fee-faq
- BoT payment-system regulation: https://breakthroughattorneys.com/payment-systems-services
- BoT 2024 annual report (6 EMIs, interoperability): https://www.bot.go.tz/Publications/Regular/Annual%20Report/sw/2025032515311662.pdf
- TZ PSP onboarding requirements (BRELA/TIN/bank): https://payatlas.com/countries/tanzania-united-republic-of-tz
- Aggregator comparison pointer (Selcom/ClickPesa/Pesapal/AzamPay/direct): https://mctaba.com/learn/tanzania/selcom-vs-clickpesa-vs-pesapal-vs-direct-api-tanzania

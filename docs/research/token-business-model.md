# Token Business Model Research (Publishing & Applying)

- **Date:** 2026-10-12
- **Issue:** kelvinpella/naja#18 — "Research business model for token purchases (publishing and applying)"
- **Context:** Naja is a Fastify + TypeScript WhatsApp marketplace connecting Tanzanian households with domestic workers. Tokens are the planned paid unit on both sides: employers spend to publish Jobs, seekers spend to apply. This issue is research-only; token ledger and paywall build follow separately.
- **Method:** Primary sources only — official pricing/FAQ pages of the compared platforms, first-party support docs, law-firm summaries of the Tanzanian Wage Order, and the Bank of Tanzania official exchange-rate table. Every factual claim carries a per-claim citation URL. Search-result snippets and secondary write-ups were used only as pointers and are flagged where they could not be verified against the primary page. Fee context (Flutterwave TZ MoMo 2.5%, TZS 1,000–500,000 limits) is reused from `docs/research/tanzania-mobile-money.md`.

## 1. Comparables

### 1.1 ZoomTanzania (TZ job board — official pricing page)

- Light: **TZS 20,000** — 1 job posting, live 2 weeks, 0 featured, next-day approval. (https://www.zoomtanzania.net/pricing)
- Silver: **TZS 100,000** — 10 postings, 5 featured, live 3 weeks, 4-hour approval. (https://www.zoomtanzania.net/pricing)
- Gold (recommended): **TZS 250,000** — 30 postings, 10 featured, live 1 month, fast-track approval + social post. (https://www.zoomtanzania.net/pricing)
- Implied per-post cost: 20,000 (Light) → 10,000 (Silver) → ~8,333 (Gold); featured is bundled, not sold separately. (https://www.zoomtanzania.net/pricing)
- Refund rule: **no refunds once a listing is posted**; listings can be edited. (https://www.zoomtanzania.net/pricing)
- Payment accepted via **Lipa numbers for Vodacom and Tigo (Yas)** — mobile-money-native checkout, consistent with Naja's MoMo plan. (https://www.zoomtanzania.net/pricing)
- Takeaway: the formal TZ job-board market prices a single post at **TZS 8k–20k** with steep bulk discounts and zero post-live refunds.

### 1.2 BrighterMonday Tanzania (TZ job board — rate card)

- A Tanzania product rate card PDF is published on BrighterMonday's own static host. (https://static.brightermonday.co.tz/brightermonday-tanzania-product-rate-card.pdf)
- The PDF content could not be extracted in this session (binary fetch unsupported), so the search-index snippet — **"Rate (Tsh) Tsh 375,000 (per listing)"** plus a ~TSh 11,500,000 premium/featured line — is **unverified and provisional**; confirm against the PDF before citing it in an ADR.
- Same-brand Kenya employer page (different market, for order-of-magnitude only): KES 5,000–21,000 per job depending on tier. (https://www.brightermonday.co.ke/employer)
- Takeaway: formal white-collar boards price an order of magnitude above ZoomTanzania; neither is Naja's direct segment (household domestic work), but they set the ceiling.

### 1.3 Jiji Tanzania (classifieds — official FAQ)

- Base listing is free; monetisation is purely visibility: **TOP** pins an ad at top of search for **7 or 30 days**. (https://jiji.co.tz/faq/33)
- **Boost Packages** run **1, 3, 6 or 12 months** across all ads (Basic/Premium/VIP/VIP Gold/Diamond tiers: 2×–10× more clients claimed, auto-renew every 48h→6h, TOP+ bundles of 5–500). (https://jiji.co.tz/faq/33)
- **Pro Sales** is a separate **pay-per-click** tool bundled with Boost access — advertiser sets a budget and pays per actual click. (https://jiji.co.tz/faq/33)
- Premium Services are bought per category group (Others / Cars / Property / All-in-one) with duration choice; **no TZS price is published on the FAQ pages** — prices are shown only inside the logged-in purchase flow. (https://jiji.co.tz/faq/40)
- Takeaway: the closest proven model for Naja's segment is **free base + paid visibility duration tiers + optional pay-per-click** — not pay-per-action on the seeker side.

### 1.4 Kupatana (TZ classifieds — official homepage)

- Positions itself as **free classifieds** ("post your free ad", "Buy & Sell on Tanzania's #1 classifieds") with a Jobs category (~8.6k ads at fetch time) and Premium-labelled placements visible in listings. (https://kupatana.com)
- No public paid rate schedule was found on the homepage; monetisation appears to be premium placement over a free base, same shape as Jiji.
- Takeaway: in Naja's price-sensitive segment, the **free base listing is the competitive expectation** — charging for the first post risks zero liquidity.

### 1.5 Upwork Connects (global freelance credits — official support docs)

- Connects are virtual tokens freelancers spend to **submit proposals, boost proposals, and run an Availability Badge**; cost is **$0.15 each, sold in bundles** (billing method required). (https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects)
- At ~TZS 2,631/USD (BoT average 11-Oct-2026 — https://www.bot.go.tz/exchangerate/excrates), one Connect ≈ **TZS ~395**; a typical 2026 proposal (6–16 Connects) costs the seeker **~TZS 2,400–6,300** in token spend alone.
- Free supply: one-time **50-Connect bonus for new users after a purchase or Plus subscription**; **~10 free Connects/month for some freelancers**; **30 free Connects per talent badge** (Rising Talent / Top Rated / Top Rated Plus, max 90); interview and activity rewards. (https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects)
- Refunds are **token-credit, never cash**: returned if the **client cancels before a contract** or if **Upwork removes the post for ToS violation**. (https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects)
- Explicitly **not refunded**: client rejects the proposal, client hires someone else, job expires unhired, freelancer withdraws. (https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects)
- Takeaway: the mature two-sided-credit model is **free quota + paid bundles + token-only refunds on platform-side failure + no refunds on market outcomes**. Naja should copy this refund shape directly.

### 1.6 Payment-cost grounding (from `docs/research/tanzania-mobile-money.md`)

- Flutterwave TZ mobile money: **2.5% collection fee**; per-transaction limits **min TZS 1,000 / max TZS 500,000**. (https://flutterwave.com/ng/support/pricing/pricing-for-receiving-payment) (https://flutterwave.com/za/support/payments/flutterwave-limits)
- Implication: every pack must price at **≥ TZS 1,000** (rules out sub-1k micro-packs on that rail), and ~2.5–3% must be baked into margin math until AzamPay/ClickPesa quotes arrive (neither publishes a fee schedule).

## 2. Affordability anchor: what the segment earns

- Tanzania's 2025 Wage Order (effective 1 Jan 2026) sets domestic-worker minima at **TZS 80,000/month** (ordinary resident), **160,000** (non-resident), **265,000** (entitled officers' staff), **328,000** (diplomats/major businessmen). (https://www.clydeco.com/en/insights/2026/02/introduction-of-a-new-wage-order-in-tanzania)
- Same order summarised: identical four domestic bands (80k / 160k / 265k / 328k); all unspecified sectors floor **TZS 175,000/month**. (https://www.afriwise.com/blog/new-private-sector-minimum-wage-order-from-1-january-2026)
- A seeker earning 80–160k/month will not pay 8–20k to apply. A household hiring at 80–160k/month compares a posting fee against ~5–10% of one month's wage. **Working constraint: publish ≈ TZS 3k–5k, apply ≈ TZS 300–500 equivalent** — i.e. ~4–60× cheaper than formal job boards, and in the same band as one Upwork proposal (~TZS 2.4k–6.3k).

## 3. Token packaging (recommendation)

- Peg **1 token = TZS 1,000 of face value**; sell tokens only in packs (never single tokens — keeps every transaction above the TZS 1,000 MoMo floor).
- Proposed v1 packs (all prices incl. fee absorption; net = after 2.5% aggregator fee):

| Pack | Price (TZS) | Tokens | Bonus | Effective TZS/token | Net revenue (TZS) |
|---|---|---|---|---|---|
| Karibu (starter) | 2,000 | 2 | — | 1,000 | 1,950 |
| Kawaida (standard) | 5,000 | 5 + 1 bonus | 1 | ~833 | 4,875 |
| Familia (employer) | 10,000 | 12 | 2 incl. | ~833 | 9,750 |
| Biashara (bulk) | 25,000 | 32 | 7 incl. | ~781 | 24,375 |

- Why this shape: Karibu is the impulse/MoMo-test tier (matches "send a small amount first" behaviour); Kawaida/Familia cover one publish + several applies; Biashara serves repeat households/small agencies. Bulk discount capped at ~22% (steeper discounts invite farming; ZoomTanzania's 58% bulk cut works for corporates, not for a spam-sensitive P2P board).
- **Expiry:** paid tokens expire **12 months** after purchase (FIFO burn); **bonus/free tokens expire 90 days**. Rationale: 12 months survives seasonal hiring cycles; 90-day bonus expiry forces activation without creating dead-balance liability. State both in Terms Stage (`vigezo_na_masharti`) before launch.
- **Free starter:** **seekers get 3 free applies per 30-day window** (mirrors Upwork's ~10/month scaled to Naja volumes); **employers get 1 free first publish** (competitive necessity per §1.4 — Kupatana/Jiji base is free — but exactly one, to bound fake-post spam). Free tokens are non-transferable and burn first.
- **Referral/bonus:** referrer + referee each get **1 bonus token after the referee's first paid pack purchase** (never on signup — blocks farming). Cap: 5 rewarded referrals/user/month. Bonus tokens flagged `is_bonus`, 90-day expiry, excluded from any cash-refund math.

## 4. Pricing split: publish vs apply (recommendation)

| Action | Cost | Reasoning |
|---|---|---|
| Publish a Job (standard, 14-day listing) | **5 tokens** (≈ TZS 5,000 face) | Sits at ~3–6% of a domestic worker's monthly wage; ~¼–½ of ZoomTanzania's cheapest per-post (https://www.zoomtanzania.net/pricing). High enough to deter fake posts, low enough for households. |
| Feature/boost a live Job (7 days, top of broadcast order) | **+3 tokens** | Mirrors Jiji TOP 7-day unit (https://jiji.co.tz/faq/33); keeps base publish accessible while monetising urgency. |
| Re-list / extend expired Job | **2 tokens** | Cheaper than new publish (no re-Review cost); discourages duplicate-post spam to dodge expiry. |
| Apply to a Job | **1 token** after free quota | Mirrors a minimal Upwork proposal (~TZS 395–2,400); per-application cost is the primary spam throttle. |
| Seeker free quota | 3 applies / 30 days | Activation without spam; Upwork precedent for monthly free supply (https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects). |
| Employer free quota | 1st publish free | Matches free-base expectation of Jiji/Kupatana (https://jiji.co.tz/faq/33) (https://kupatana.com); Review-gated (§6) bounds abuse. |

- Anti-spam effects: publish fee kills bulk fake posts (attacker cost scales linearly); per-apply fee kills spray-and-pray (each application has marginal cost); free quotas are small enough that farming them costs more in SIM/effort than the tokens are worth, especially with phone-verified identity and non-transferability.
- Deliberately **not** charging: browsing/searching (kills demand-side liquidity), reading applications as an employer (employer already paid to publish; double-charging collapses posting).

## 5. Revenue modelling (2–3 price sets at plausible volumes)

Assumptions: 30-day month; applications/post ~8 (domestic-work posts attract many low-effort applies — the reason per-apply pricing exists); paying mix: 60% of publishes paid (rest first-free), 50% of applies paid (rest free quota); aggregator fee 2.5%; face value 1 token = TZS 1,000.

| Scenario | Posts/day | Publishes (30d) | Applies/post | Total applies | Paid tokens (pub + app) | Gross face (TZS) | Net @−2.5% (TZS) |
|---|---|---|---|---|---|---|---|
| A — Lean (v1 proposed: 5 pub / 1 apply) | 5 | 150 | 8 | 1,200 | 450 + 600 = 1,050 | 1,050,000 | ~1,024,000 |
| B — Lean at 2× volume | 10 | 300 | 8 | 2,400 | 900 + 1,200 = 2,100 | 2,100,000 | ~2,048,000 |
| C — Low-price alt (3 pub / 1 apply) | 10 | 300 | 10 | 3,000 | 540 + 1,500 = 2,040 | 2,040,000 | ~1,989,000 |

- Reading: at plausible early volumes, monthly net is **~TZS 1–2M (~USD 380–780** at BoT ~2,631/USD — https://www.bot.go.tz/exchangerate/excrates). This covers infra (Zernio + Supabase + Redis) but not staff — v1 pricing buys liquidity, not profitability. Do not chase revenue by raising apply cost: demand elasticity on the seeker side (80k/month wage base) is the binding constraint.
- Sensitivity: if applications/post runs to 15 (likely without apply fees), Scenario A gross rises only if applies are paid — which is exactly why the 1-token apply fee must ship with v1, not later.
- Break-even note: with ~2.5% fees, margin is ~97.5% on token face; fixed costs dominate, so the KPI is **paid publishes/week**, not fee optimisation.

## 6. Refunds, expiry of listings, and edge cases (recommendation)

Adopt Upwork's split (token-credit on platform failure, no refund on market outcomes — https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects) layered over ZoomTanzania's no-post-live-refund rule (https://www.zoomtanzania.net/pricing):

- **Job rejected in Review → full publish-fee refund in tokens** (platform-side failure; keeps honest employers willing to post). Bonus/free tokens used are returned as bonus tokens.
- **Job removed for ToS violation → same as rejection** (Upwork precedent), but account flagged; repeat offenders lose free-publish eligibility.
- **Job expires with no hire, employer withdraws early, application rejected/ignored, seeker withdraws application → NO refund** on either side. Rationale: these are market outcomes; refunding them subsidises spam and complicates the ledger.
- **Duplicate charge / credited-in-error → reversal via the MoMo reversal path** (M-Pesa OpenAPI exposes reversal; AzamPay claims same-day refunds — see `docs/research/tanzania-mobile-money.md` §5), then burn the wrongly-credited tokens before any cash refund.
- **Bulk/employer packs:** Biashara pack (§3) is the v1 bulk offer; custom agency invoicing is out of scope until repeat-poster data exists.
- **Fraud/abuse controls (for ledger-build tickets):** tokens non-transferable, no cash-out (blocks farming-for-cash); one free publish per verified phone number ever; referral payout only after referee's first *paid* pack; per-phone daily caps (e.g. 3 publishes, 20 applies); duplicate-post detection (same phone + similar title/description within 14 days = re-list price, not new publish); free-quota applies rate-limited per Job (1 application per seeker per Job); all token movements append-only ledger with idempotency keys (same pattern as `docs/research/tanzania-mobile-money.md` §7).

## 7. Open questions (for follow-up tickets / onboarding calls)

- Actual AzamPay/ClickPesa fee % and settlement T+X — re-run §5 net math with real numbers once quotes arrive.
- Whether TZS 5,000 publish clears willingness-to-pay for rural households — needs 10–15 user interviews before locking v1.
- Zernio template/message costs per broadcast — broadcast-to-seekers has a per-message cost that §5 ignores; confirm who bears it.
- TCRA/content rules for paid job broadcasts over WhatsApp (opt-in wording, working-hours limits).
- BrighterMonday TZ rate-card confirmation (TSh 375,000/listing snippet unverified — https://static.brightermonday.co.tz/brightermonday-tanzania-product-rate-card.pdf).

## Sources

- ZoomTanzania official pricing (Light 20k / Silver 100k / Gold 250k, durations, featured counts, no-refund rule, Lipa numbers): https://www.zoomtanzania.net/pricing
- BrighterMonday Tanzania rate card PDF (existence; per-listing figure unverified): https://static.brightermonday.co.tz/brightermonday-tanzania-product-rate-card.pdf
- BrighterMonday Kenya employer pricing (KES/job tiers, different market): https://www.brightermonday.co.ke/employer
- Jiji Tanzania premium-service types (TOP 7/30d, Boost 1–12mo tiers, Pro Sales pay-per-click): https://jiji.co.tz/faq/33
- Jiji Tanzania how-to-buy Premium (category groups, no public TZS prices): https://jiji.co.tz/faq/40
- Kupatana homepage (free classifieds positioning, Jobs category): https://kupatana.com
- Upwork official support — Connects price $0.15, bundles, free-supply rules, token-only refund split: https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects
- Clyde & Co on Tanzania 2025 Wage Order (domestic bands 80k/160k/265k/328k, general floor 175k): https://www.clydeco.com/en/insights/2026/02/introduction-of-a-new-wage-order-in-tanzania
- Afriwise summary of the 2025 Wage Order (same domestic bands): https://www.afriwise.com/blog/new-private-sector-minimum-wage-order-from-1-january-2026
- Bank of Tanzania official exchange rates (USD avg 2630.891, 11-Oct-2026): https://www.bot.go.tz/exchangerate/excrates
- Flutterwave TZ MoMo pricing 2.5% (via prior research): https://flutterwave.com/ng/support/pricing/pricing-for-receiving-payment
- Flutterwave TZ MoMo limits 1k–500k (via prior research): https://flutterwave.com/za/support/payments/flutterwave-limits

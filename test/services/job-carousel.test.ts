import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  APPLY_BUTTON_TITLE,
  DETAIL_BUTTON_TITLE,
  MORE_BUTTON_TITLE,
  applyConfirmationBody,
  buildJobListView,
  cardBody,
  detailPayload,
  emptySearchBody,
  excerpt,
  formatPostedDate,
  fullDetailBody,
  morePayload,
  parseJobPayload,
  parseMorePayload,
  searchHeading,
  MIXED_HEADING,
  MORE_BATCH_HEADING,
} from "../../src/services/jobs/job-carousel.js";
import type { JobListing } from "../../src/services/jobs/job-types.js";

function job(overrides: Partial<JobListing> = {}): JobListing {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    createdAt: "2026-10-02T10:00:00Z",
    title: "Mpishi",
    description: "A".repeat(200),
    budget: 150000,
    skills: ["kupika"],
    posterPhone: "+255712345678",
    ...overrides,
  };
}

describe("job carousel builder", () => {
  it("truncates descriptions to ~150 chars with ellipsis", () => {
    assert.equal(excerpt("short"), "short");
    assert.equal(excerpt("A".repeat(200)).length, 153);
    assert.ok(excerpt("A".repeat(200)).endsWith("..."));
  });

  it("renders title, date, excerpt, and amount without the Budget word", () => {
    const body = cardBody(
      job({ title: "Mpishi", createdAt: "2026-10-07T10:00:00Z", budget: 150000 }),
    );
    assert.ok(body.startsWith("*Mpishi*\n07/10/26"));
    assert.ok(body.includes("Tsh: 150,000"));
    assert.ok(!body.includes("Budget"));
  });

  it("formats posted dates as DD/MM/YY and skips invalid dates", () => {
    assert.equal(formatPostedDate("2026-10-07T10:00:00Z"), "07/10/26");
    assert.equal(formatPostedDate("not-a-date"), "");
  });

  it("includes the date in the full detail body without the Budget word", () => {
    const body = fullDetailBody(
      job({ title: "Mpishi", createdAt: "2026-10-07T10:00:00Z", budget: 150000 }),
    );
    assert.ok(body.startsWith("*Mpishi*\n07/10/26"));
    assert.ok(body.includes("Tsh: 150,000"));
    assert.ok(!body.includes("Budget"));
  });

  it("keeps full detail bodies within the 1024-char message limit", () => {
    const body = fullDetailBody(
      job({ title: "A".repeat(100), description: "B".repeat(5000), budget: 1 }),
    );
    assert.ok(body.length <= 1000);
    assert.ok(body.endsWith("...") || body.includes("Tsh: 1"));
  });

  it("keeps card bodies under Meta's 160-char and 2-line-break limits", () => {
    const long = job({
      title: "A".repeat(80),
      description: "B".repeat(500),
      budget: 123456789,
    });
    assert.ok(cardBody(long).length < 160);
    assert.ok(
      (cardBody(long).match(/\n/g) ?? []).length <= 2,
    );
    assert.ok(
      cardBody(job({ description: "C".repeat(500), budget: 150000 })).length <
        160,
    );
    assert.ok(cardBody(job({ description: null, budget: null })).length < 160);
  });

  it("encodes detail/apply payloads per job id", () => {
    assert.deepEqual(parseJobPayload(detailPayload("abc")), {
      stage: "detail",
      jobId: "abc",
    });
    assert.equal(parseJobPayload("job_apply:abc")?.stage, "apply");
    assert.equal(parseJobPayload("tafuta_kazi"), null);
  });

  it("round-trips pagination cursors for mixed and search lists", () => {
    assert.deepEqual(parseMorePayload(morePayload({ kind: "mixed" }, 9)), {
      origin: { kind: "mixed" },
      offset: 9,
    });
    assert.deepEqual(
      parseMorePayload(
        morePayload({ kind: "search", keyword: "mpishi" }, 18),
      ),
      { origin: { kind: "search", keyword: "mpishi" }, offset: 18 },
    );
    assert.equal(parseMorePayload("job_more:bogus"), null);
  });

  it("returns empty view when there are no jobs", () => {
    assert.equal(
      buildJobListView({ jobs: [], hasMore: false }, { kind: "mixed" }, 0, "H").kind,
      "empty",
    );
  });

  it("returns single view for one job without more pages", () => {
    const view = buildJobListView(
      { jobs: [job()], hasMore: false },
      { kind: "mixed" },
      0,
      "H",
    );
    assert.equal(view.kind, "single");
  });

  it("names the category in list headings", () => {
    assert.equal(
      MIXED_HEADING,
      "Hizi ndizo kazi mchanganyiko. Swipe kutizama zaidi",
    );
    assert.equal(
      searchHeading("mpishi"),
      "Hizi ndizo kazi zilizotangazwa: mpishi",
    );
    assert.equal(MORE_BATCH_HEADING, "Kazi zaidi zilizotangazwa");
  });

  it("names the keyword in the empty search body", () => {
    assert.ok(emptySearchBody("mpishi").includes('"mpishi"'));
    assert.ok(!emptySearchBody("").includes('""'));
  });

  it("builds the apply confirmation with checkmark and poster phone", () => {
    const body = applyConfirmationBody("+255712345678");
    assert.ok(body.startsWith("✅ Waweza wasiliana"));
    assert.ok(body.includes("\n\nPhone:+255712345678"));
  });

  it("keeps every carousel button title and id within Meta limits", () => {
    for (const title of [DETAIL_BUTTON_TITLE, APPLY_BUTTON_TITLE, MORE_BUTTON_TITLE]) {
      assert.ok(title.length <= 20, `"${title}" exceeds 20 chars`);
    }
    const cjk = "字".repeat(60);
    assert.ok(morePayload({ kind: "search", keyword: cjk }, 9).length <= 200);
    assert.ok(
      morePayload({ kind: "search", keyword: "mpishi" }, 12345).length <= 200,
    );
  });

  it("truncates overlong keywords in search headings", () => {
    const heading = searchHeading("x".repeat(500));
    assert.ok(heading.length <= 150);
    assert.ok(heading.startsWith("Hizi ndizo kazi zilizotangazwa: "));
  });

  it("appends a Tizama navigation card when more pages exist", () => {    const jobs = Array.from({ length: 9 }, (_, i) =>
      job({ id: `job-${i}`, title: `Kazi ${i}` }),
    );
    const view = buildJobListView(
      { jobs, hasMore: true },
      { kind: "mixed" },
      0,
      "H",
    );
    assert.equal(view.kind, "carousel");
    if (view.kind !== "carousel") return;
    assert.equal(view.cards.length, 10);
    const last = view.cards[view.cards.length - 1];
    assert.equal(last.buttons.length, 2);
    assert.equal(last.buttons[0].title, "Tizama kazi zaidi");
    const first = view.cards[0];
    assert.deepEqual(
      first.buttons.map((button) => button.title),
      ["Soma zaidi", "Omba"],
    );
  });

  it("puts the area on the date line with a pin and no Eneo word", () => {
    const body = cardBody(
      job({ title: "Mpishi", createdAt: "2026-10-07T10:00:00Z", area: "Mbezi" }),
    );
    assert.ok(body.includes("07/10/26   📍 Mbezi"));
    assert.ok(!body.includes("Eneo"));
  });

  it("truncates long areas but keeps card bodies under 160 chars", () => {
    const body = cardBody(
      job({
        title: "A".repeat(80),
        description: "B".repeat(500),
        area: "C".repeat(80),
        budget: 123456789,
      }),
    );
    assert.ok(body.length <= 160);
    assert.ok(body.includes("📍 "));
  });

  it("uses the job image per card with placeholder fallback", () => {
    const jobs = [
      job({ id: "job-img", jobImage: "https://example.com/a.jpg" }),
      job({ id: "job-plain", jobImage: null }),
    ];
    const view = buildJobListView({ jobs, hasMore: false }, { kind: "mixed" }, 0, "H");
    assert.equal(view.kind, "carousel");
    if (view.kind !== "carousel") return;
    assert.equal(view.cards[0].imageUrl, "https://example.com/a.jpg");
    assert.ok(view.cards[1].imageUrl.includes("cloudinary"));
  });
});

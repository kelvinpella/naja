import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DETAIL_BUTTON_TITLE,
  JOB_CARD_PLACEHOLDER_IMAGE,
  MAX_CAROUSEL_CARDS,
  buildJobCards,
  cardBody,
  detailPayload,
  excerpt,
  formatPostedDate,
  jobDetailText,
  parseDetailPayload,
} from "../../src/services/jobs/job-cards.js";
import type { JobListing } from "../../src/services/jobs/job-types.js";

function job(overrides: Partial<JobListing> = {}): JobListing {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    createdAt: "2026-10-07T10:00:00Z",
    title: "Mpishi",
    description: "Nahitaji mpishi wa pilau weekend",
    area: "Mbezi",
    budget: 150_000,
    jobImage: null,
    ...overrides,
  };
}

describe("job card rendering", () => {
  it("renders title, date, excerpt and amount without the word budget", () => {
    const body = cardBody(job());
    assert.ok(body.startsWith("*Mpishi*\n07/10/26"));
    assert.ok(body.includes("Tsh 150,000"));
    assert.ok(!body.includes("Budget"));
  });

  it("keeps card bodies inside Meta's 160 characters", () => {
    const long = job({
      title: "A".repeat(80),
      description: "B".repeat(500),
      budget: 123_456_789,
    });
    assert.ok(cardBody(long).length <= 160);
  });

  it("truncates descriptions with an ellipsis", () => {
    assert.equal(excerpt("short"), "short");
    assert.ok(excerpt("A".repeat(200)).endsWith("..."));
  });

  it("skips an unparseable date rather than printing Invalid Date", () => {
    assert.equal(formatPostedDate("not-a-date"), "");
  });

  it("caps a carousel at ten cards", () => {
    const jobs = Array.from({ length: 12 }, (_, index) =>
      job({ id: `job-${index}` }),
    );
    assert.equal(buildJobCards(jobs).length, MAX_CAROUSEL_CARDS);
  });

  it("uses the Job's photo when it has one and the placeholder when not", () => {
    const [withPhoto, withoutPhoto] = buildJobCards([
      job({ jobImage: "https://example.test/photo.jpg" }),
      job({ id: "job-2" }),
    ]);
    assert.equal(withPhoto?.imageUrl, "https://example.test/photo.jpg");
    assert.equal(withoutPhoto?.imageUrl, JOB_CARD_PLACEHOLDER_IMAGE);
  });

  it("gives every card one detail button carrying the Job id", () => {
    const [card] = buildJobCards([job({ id: "job-1" })]);
    assert.deepEqual(card?.buttons, [
      { id: detailPayload("job-1"), title: DETAIL_BUTTON_TITLE },
    ]);
    assert.equal(parseDetailPayload(card?.buttons[0]?.id), "job-1");
  });

  it("reads only job_detail payloads", () => {
    assert.equal(parseDetailPayload("job_more:9"), null);
    assert.equal(parseDetailPayload(undefined), null);
    assert.equal(parseDetailPayload("job_detail:"), null);
  });

  it("keeps a detail body under WhatsApp's limit and includes the area", () => {
    const body = jobDetailText(
      job({ title: "A".repeat(100), description: "B".repeat(5000) }),
    );
    assert.ok(body.length <= 1000);
    assert.ok(body.includes("Eneo: Mbezi"));
    assert.ok(body.includes("Tsh 150,000"));
  });
});

import { createFindJobSearchDraftFlow } from "../services/stages/find-job/flow.js";

async function main(): Promise<void> {
  const accountId = process.env["ZERNIO_ACCOUNT_ID"];
  const apiKey = process.env["ZERNIO_API_KEY"];

  if (!accountId || !apiKey) {
    console.error("Set ZERNIO_ACCOUNT_ID and ZERNIO_API_KEY to create a DRAFT Flow.");
    process.exit(1);
  }

  const { flowId, reused } = await createFindJobSearchDraftFlow(accountId, apiKey);
  console.log(`${reused ? "Reused" : "Created"} DRAFT Flow ${flowId}. Set ZERNIO_FIND_JOB_FLOW_ID=${flowId} to test sending with draft:true.`);
  console.log("Do not publish — this Flow stays DRAFT for testing.");
}

void main().catch((error: unknown) => {
  console.error("Failed to create DRAFT Flow:", error);
  process.exit(1);
});

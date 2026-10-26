import { createFindJobSearchDraftFlow } from "../services/stages/find-job/flow.js";

async function main(): Promise<void> {
  const wabaId =
    process.env["KAPSO_BUSINESS_ACCOUNT_ID"] ??
    process.env["KAPSO_WABA_ID"];
  const apiKey = process.env["KAPSO_API_KEY"];

  if (!wabaId || !apiKey) {
    console.error(
      "Set KAPSO_BUSINESS_ACCOUNT_ID and KAPSO_API_KEY to create a DRAFT Flow.",
    );
    process.exitCode = 1;
    return;
  }

  const { flowId } = await createFindJobSearchDraftFlow(wabaId, apiKey);
  console.log(
    `Created DRAFT Flow ${flowId}. Set KAPSO_FIND_JOB_FLOW_ID=${flowId} to test sending with mode:draft.`,
  );
}

void main().catch((error: unknown) => {
  console.error("Failed to create find-job DRAFT Flow:", error);
  process.exitCode = 1;
});

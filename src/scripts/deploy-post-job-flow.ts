import {
  POST_JOB_FLOW_CATEGORIES,
  POST_JOB_FLOW_JSON,
  POST_JOB_FLOW_NAME,
} from "../services/flows/post-job-flow.js";
import { getKapsoClient } from "../services/kapso-client.js";

// Meta's GET /{waba-id}/flows shape.
type FlowList = {
  data?: { id?: string; name?: string; status?: string }[];
};

async function main(): Promise<void> {
  const apiKey = process.env["KAPSO_API_KEY"];
  const wabaId = process.env["KAPSO_BUSINESS_ACCOUNT_ID"];

  if (!apiKey || !wabaId) {
    console.error(
      "Set KAPSO_API_KEY and KAPSO_BUSINESS_ACCOUNT_ID (the WABA id) to deploy the Flow.",
    );
    process.exit(1);
  }

  const kapso = getKapsoClient(apiKey);
  // Reuse the draft by name: deploy() creates unconditionally when no flowId
  // is given, and Meta rejects a duplicate name.
  const listed = await kapso.flows.list<FlowList>({ wabaId, limit: 100 });
  const existing = listed.data?.find((flow) => flow.name === POST_JOB_FLOW_NAME);

  const result = await kapso.flows.deploy(POST_JOB_FLOW_JSON, {
    name: POST_JOB_FLOW_NAME,
    wabaId,
    flowId: existing?.id,
    categories: [...POST_JOB_FLOW_CATEGORIES],
    // Never published by this codebase: these messages go out in draft mode.
    publish: false,
  });

  if (result.validationErrors?.length) {
    console.error("Flow JSON has validation errors:");
    for (const error of result.validationErrors) {
      console.error(`- ${error.message ?? error.error}`);
    }
    process.exitCode = 1;
    return;
  }

  const action = existing ? "Updated" : "Created";
  console.log(`${action} DRAFT Flow "${POST_JOB_FLOW_NAME}".`);
  console.log(`KAPSO_POST_JOB_FLOW_ID=${result.flowId}`);
  if (result.previewUrl) console.log(`Preview: ${result.previewUrl}`);
  console.log("Add the line above to .env. Do not publish — the Flow stays DRAFT.");
}

void main().catch((error: unknown) => {
  console.error("Failed to deploy the post job Flow:", error);
  process.exitCode = 1;
});

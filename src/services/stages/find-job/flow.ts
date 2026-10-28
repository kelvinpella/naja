import { unwrapFlowPayload } from "../flow-payload.js";
import { createDraftFlow } from "../draft-flow.js";

// Draft-only Flow JSON for keyword search.
// Lifecycle: DRAFT -> upload JSON -> send with draft:true for testing.
// Never published by this codebase.
export const FIND_JOB_SEARCH_FLOW_NAME = "tafuta_kazi_search";
export const FIND_JOB_SEARCH_FLOW_CATEGORIES = ["SURVEY"] as const;
export const FIND_JOB_SEARCH_FLOW_SCREEN = "SEARCH";
export const FIND_JOB_SEARCH_FLOW_CTA = "Tafuta";

export const FIND_JOB_SEARCH_FLOW_JSON = {
  version: "7.1",
  screens: [
    {
      id: "SEARCH",
      title: "Tafuta kazi",
      terminal: true,
      data: {},
      layout: {
        type: "SingleColumnLayout",
        children: [
          {
            type: "Form",
            name: "search_form",
            children: [
              {
                type: "TextHeading",
                text: "Tafuta kazi",
              },
              {
                type: "TextInput",
                label: "Andika jina la kazi",
                required: true,
                name: "keyword",
                ["inputType"]: "text",
                ["helperText"]: "Mfano: mpishi, dereva, mlinzi",
              },
              {
                type: "Footer",
                label: "Tafuta",
                ["onClickAction"]: {
                  name: "complete",
                  payload: {
                    keyword: "${form.keyword}",
                  },
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

export function getFindJobSearchFlowId(): string | undefined {
  return process.env["KAPSO_FIND_JOB_FLOW_ID"];
}

export type FindJobSearchResult = {
  keyword?: unknown;
  raw: unknown;
};

// Uses the official @kapso/whatsapp-cloud-api SDK via the shared draft
// helper. Creates a DRAFT with its JSON. Never calls publish — stays DRAFT
// for testing.
export async function createFindJobSearchDraftFlow(
  wabaId: string,
  apiKey: string,
): Promise<{ flowId: string; reused: boolean }> {
  return createDraftFlow(
    {
      name: FIND_JOB_SEARCH_FLOW_NAME,
      categories: FIND_JOB_SEARCH_FLOW_CATEGORIES,
      flowJson: FIND_JOB_SEARCH_FLOW_JSON,
      logTag: "find-job-flow",
    },
    wabaId,
    apiKey,
  );
}

export function parseFindJobSearchResponse(
  responseData: unknown,
): FindJobSearchResult {
  const record =
    typeof responseData === "object" && responseData !== null
      ? (responseData as Record<string, unknown>)
      : {};
  return { keyword: record["keyword"], raw: responseData };
}

// Adapter entry: unwrap wire shape then parse, so callers never touch
// response_json plumbing.
export function parseFindJobFlowPayload(raw: unknown): FindJobSearchResult {
  return parseFindJobSearchResponse(unwrapFlowPayload(raw));
}

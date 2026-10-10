import { Zernio } from "@zernio/node";

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
                ["input-type"]: "text",
                ["helper-text"]: "Mfano: mpishi, dereva, mlinzi",
              },
              {
                type: "Footer",
                label: "Tafuta",
                ["on-click-action"]: {
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
  return (
    process.env["ZERNIO_FIND_JOB_FLOW_ID"] ??
    process.env["ZERNIO_TAFUTA_FLOW_ID"] ??
    process.env["ZERNIO_FLOW_ID"]
  );
}

const MAX_FLOW_VERSION_RETRIES = 5;

type FlowLogger = { warn: (...args: unknown[]) => void };
const defaultFlowLogger: FlowLogger = { warn: (...args: unknown[]) => console.warn(...args) };

export type FindJobSearchResult = {
  keyword?: unknown;
  raw: unknown;
};

// Uses official @zernio/node SDK. Creates a DRAFT and uploads JSON.
// Never calls publish — stays DRAFT for testing.
// Reuses the existing DRAFT with the same name if Meta reports
// "Flow name is not unique" (error_subcode 4016019).
export async function createFindJobSearchDraftFlow(
  accountId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ flowId: string; reused: boolean }> {
  const zernio = new Zernio({ apiKey });

  const uploadJson = async (flowId: string): Promise<void> => {
    const { error: uploadError } =
      await zernio.whatsappflows.uploadWhatsAppFlowJson({
        path: { flowId },
        body: { accountId, flow_json: FIND_JOB_SEARCH_FLOW_JSON },
        signal,
      });
    if (uploadError) {
      throw new Error("Zernio flow JSON upload failed", { cause: uploadError });
    }
  };

  const listFlowsByName = async (
    name: string,
  ): Promise<{ id?: string; name?: string; status?: string }[]> => {
    try {
      const { data, error } = await zernio.whatsappflows.listWhatsAppFlows({
        query: { accountId },
        signal,
      });
      if (error) {
        defaultFlowLogger.warn(`[find-job-flow] listWhatsAppFlows failed:`, error);
        return [];
      }
      if (!data?.flows) return [];
      return data.flows.filter(
        (flow: { name?: string }) => flow.name === name,
      );
    } catch (error) {
      defaultFlowLogger.warn(`[find-job-flow] listWhatsAppFlows threw:`, error);
      return [];
    }
  };

  const createWithName = async (
    name: string,
  ): Promise<{ flowId: string } | undefined> => {
    try {
      const { data, error } = await zernio.whatsappflows.createWhatsAppFlow({
        body: {
          accountId,
          name,
          categories: [...FIND_JOB_SEARCH_FLOW_CATEGORIES],
        },
        signal,
      });
      if (!error && data?.flow?.id) return { flowId: data.flow.id };
    } catch (error) {
      // Name taken (4016019) surfaces as thrown _ZernioApiError — fall through to reuse/version.
      defaultFlowLogger.warn(`[find-job-flow] createWhatsAppFlow failed for ${name}:`, error instanceof Error ? error.message : error);
    }
    return undefined;
  };

  const created = await createWithName(FIND_JOB_SEARCH_FLOW_NAME);
  if (created) {
    await uploadJson(created.flowId);
    return { flowId: created.flowId, reused: false };
  }

  // Name taken: reuse the DRAFT if there is one, otherwise version the name
  // (existing is PUBLISHED/BLOCKED/etc. and can't be overwritten).
  const existing = await listFlowsByName(FIND_JOB_SEARCH_FLOW_NAME);
  const draft = existing.find((flow) => flow.status === "DRAFT" && flow.id);
  if (draft?.id) {
    await uploadJson(draft.id);
    return { flowId: draft.id, reused: true };
  }

  for (let version = 2; version <= MAX_FLOW_VERSION_RETRIES; version += 1) {
    const versioned = `${FIND_JOB_SEARCH_FLOW_NAME}_v${version}`;
    const alreadyTaken = (await listFlowsByName(versioned)).length > 0;
    if (alreadyTaken) continue;
    const retry = await createWithName(versioned);
    if (retry) {
      await uploadJson(retry.flowId);
      defaultFlowLogger.warn(
        `[find-job-flow] Name ${FIND_JOB_SEARCH_FLOW_NAME} taken (status: ${existing.map((flow) => flow.status).join(",") || "unknown"}), created ${versioned} instead.`,
      );
      return { flowId: retry.flowId, reused: false };
    }
  }

  throw new Error(
    `Zernio flow draft creation failed: name ${FIND_JOB_SEARCH_FLOW_NAME} taken by non-DRAFT flow (${existing.map((flow) => `${flow.status}:${flow.id}`).join(", ") || "unknown"}). Rename the constant or delete the blocking flow.`,
  );
}

export function parseFindJobSearchResponse(
  responseData: unknown,
): FindJobSearchResult {
  const record =
    typeof responseData === "object" && responseData !== null && !Array.isArray(responseData)
      ? (responseData as Record<string, unknown>)
      : {};
  const rawKeyword = record["keyword"];
  const keyword = typeof rawKeyword === "string" ? rawKeyword.trim() : rawKeyword;
  return { keyword: typeof keyword === "string" && keyword ? keyword : undefined, raw: responseData };
}

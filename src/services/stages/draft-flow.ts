// Shared DRAFT Flow creator behind both Stage Flows. Lifecycle: DRAFT with
// JSON uploaded -> send with mode:"draft" for testing. Never published by
// this codebase. Reuses an existing DRAFT with the same name when Meta
// reports the name as taken, otherwise versions the name.
import { getKapsoClient } from "../kapso-client.js";

export type DraftFlowSpec<T> = {
  name: string;
  categories: readonly string[];
  flowJson: T;
  logTag: string;
};

type FlowSummary = { id?: string; name?: string; status?: string };

export async function createDraftFlow<T>(
  spec: DraftFlowSpec<T>,
  wabaId: string,
  apiKey: string,
): Promise<{ flowId: string; reused: boolean }> {
  const kapso = getKapsoClient(apiKey);

  const listFlowsByName = async (name: string): Promise<FlowSummary[]> => {
    try {
      const response = await kapso.flows.list<{ data?: FlowSummary[] }>({
        wabaId,
      });
      return (response?.data ?? []).filter((flow) => flow.name === name);
    } catch {
      return [];
    }
  };

  const createWithName = async (
    name: string,
  ): Promise<{ flowId: string } | undefined> => {
    const created = await kapso.flows.create({
      wabaId,
      name,
      categories: [...spec.categories],
      flowJson: spec.flowJson as Record<string, unknown>,
      publish: false,
    });
    if (!created.id) return undefined;
    if (created.validationErrors?.length) {
      throw new Error(
        `Kapso flow JSON rejected: ${created.validationErrors
          .map((item) => item.message ?? item.error)
          .join("; ")}`,
      );
    }
    return { flowId: created.id };
  };

  try {
    const created = await createWithName(spec.name);
    if (created) return { flowId: created.flowId, reused: false };
  } catch (error) {
    // Name taken, or the create failed for a retryable reason. Reuse an
    // existing DRAFT with this name before giving up.
    const existing = await listFlowsByName(spec.name);
    const draft = existing.find((flow) => flow.status === "DRAFT" && flow.id);
    if (draft?.id) {
      await kapso.flows.updateAsset({
        flowId: draft.id,
        json: spec.flowJson as Record<string, unknown>,
        // The Kapso proxy resolves the WhatsApp configuration from this id;
        // without it the asset upload fails with "configuration not found".
        businessAccountId: wabaId,
      });
      return { flowId: draft.id, reused: true };
    }

    // Existing flow is PUBLISHED/BLOCKED/etc. and can't be overwritten:
    // create a versioned DRAFT instead.
    for (let version = 2; version <= 5; version += 1) {
      const versioned = `${spec.name}_v${version}`;
      const alreadyTaken = (await listFlowsByName(versioned)).length > 0;
      if (alreadyTaken) continue;
      try {
        const retry = await createWithName(versioned);
        if (retry) {
          console.warn(
            `[${spec.logTag}] Name ${spec.name} taken (status: ${existing
              .map((flow) => flow.status)
              .join(",") || "unknown"}), created ${versioned} instead.`,
          );
          return { flowId: retry.flowId, reused: false };
        }
      } catch {
        // Try the next version number.
      }
    }

    throw new Error(
      `Kapso flow draft creation failed for ${spec.name}; the name is taken or Meta rejected the JSON.`,
      { cause: error },
    );
  }

  throw new Error(`Kapso flow draft creation returned no id for ${spec.name}`);
}

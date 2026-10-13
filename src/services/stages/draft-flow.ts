// Shared DRAFT Flow creator behind both Stage Flows. Lifecycle: DRAFT ->
// upload JSON -> send with draft:true for testing. Never published by this
// codebase. Reuses the existing DRAFT with the same name if Meta reports
// "Flow name is not unique", otherwise versions the name.
import { getZernioClient } from "../zernio-client.js";

export type DraftFlowSpec<T> = {
  name: string;
  categories: readonly string[];
  flowJson: T;
  logTag: string;
};

export async function createDraftFlow<T>(
  spec: DraftFlowSpec<T>,
  accountId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ flowId: string; reused: boolean }> {
  const zernio = getZernioClient(apiKey);

  const uploadJson = async (flowId: string): Promise<void> => {
    const { error: uploadError } =
      await zernio.whatsappflows.uploadWhatsAppFlowJson({
        path: { flowId },
        body: { accountId, flow_json: spec.flowJson },
        signal,
      });
    if (uploadError) {
      throw new Error("Zernio flow JSON upload failed", { cause: uploadError });
    }
  };

  const listFlowsByName = async (
    name: string,
  ): Promise<{ id?: string; name?: string; status?: string }[]> => {
    const { data, error } = await zernio.whatsappflows.listWhatsAppFlows({
      query: { accountId },
      signal,
    });
    if (error || !data?.flows) return [];
    return data.flows.filter(
      (flow: { name?: string }) => flow.name === name,
    );
  };

  const createWithName = async (
    name: string,
  ): Promise<{ flowId: string } | undefined> => {
    try {
      const { data, error } = await zernio.whatsappflows.createWhatsAppFlow({
        body: {
          accountId,
          name,
          categories: [...spec.categories],
        },
        signal,
      });
      if (!error && data?.flow?.id) return { flowId: data.flow.id };
    } catch {
      // Name taken surfaces as a thrown _ZernioApiError on some SDK paths
      // and as an error return on others — fall through to DRAFT reuse /
      // versioned-name retry below either way.
    }
    return undefined;
  };

  const created = await createWithName(spec.name);
  if (created) {
    await uploadJson(created.flowId);
    return { flowId: created.flowId, reused: false };
  }

  // Name taken: reuse the DRAFT if there is one, otherwise version the name
  // (existing is PUBLISHED/BLOCKED/etc. and can't be overwritten).
  const existing = await listFlowsByName(spec.name);
  const draft = existing.find((flow) => flow.status === "DRAFT" && flow.id);
  if (draft?.id) {
    await uploadJson(draft.id);
    return { flowId: draft.id, reused: true };
  }

  for (let version = 2; version <= 5; version += 1) {
    const versioned = `${spec.name}_v${version}`;
    const alreadyTaken = (await listFlowsByName(versioned)).length > 0;
    if (alreadyTaken) continue;
    const retry = await createWithName(versioned);
    if (retry) {
      await uploadJson(retry.flowId);
      console.warn(
        `[${spec.logTag}] Name ${spec.name} taken (status: ${existing.map((flow) => flow.status).join(",") || "unknown"}), created ${versioned} instead.`,
      );
      return { flowId: retry.flowId, reused: false };
    }
  }

  throw new Error(
    `Zernio flow draft creation failed: name ${spec.name} taken by non-DRAFT flow (${existing.map((flow) => `${flow.status}:${flow.id}`).join(", ") || "unknown"}). Rename the constant or delete the blocking flow.`,
  );
}

// Flow wire-shape unwrap. Lives in the Stage adapters so the conversation
// orchestrator never touches response_json plumbing (Q7).
export function unwrapFlowPayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed["response_json"] === "object"
    ) {
      return parsed["response_json"];
    }
    return parsed;
  } catch {
    return raw;
  }
}

// Wire-shape selection: structured Flow data wins, stringified JSON falls
// back. Handlers pass the whole job; the Data-vs-Json distinction never
// leaks into orchestration.
export function selectFlowRaw(source: {
  flowResponseData?: unknown;
  flowResponseJson?: unknown;
}): unknown {
  return source.flowResponseData ?? source.flowResponseJson;
}

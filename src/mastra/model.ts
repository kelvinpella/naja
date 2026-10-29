import type { MastraModelConfig } from "@mastra/core/llm";

// FreeLLMAPI puts many free provider tiers behind one OpenAI-compatible
// endpoint. It runs locally during development; its dashboard prints the
// unified `freellmapi-...` key that the router accepts.
const DEFAULT_FREELLMAPI_URL = "http://localhost:3001/v1";
const DEFAULT_FREELLMAPI_MODEL = "auto";
const PRODUCTION_MODEL = "openai/gpt-6-luna";

/**
 * FreeLLMAPI is opt-in: set `FREELLMAPI_API_KEY` to route Turns through the
 * local router. Without it the agent keeps using the OpenAI model.
 *
 * - `FREELLMAPI_BASE_URL` defaults to `http://localhost:3001/v1`
 * - `FREELLMAPI_MODEL` defaults to `auto`, letting the router pick a model
 */
export function resolveAgentModel(
  env: NodeJS.ProcessEnv = process.env,
): MastraModelConfig {
  const apiKey = env.FREELLMAPI_API_KEY?.trim();
  if (!apiKey) {
    return PRODUCTION_MODEL;
  }

  const model = env.FREELLMAPI_MODEL?.trim() || DEFAULT_FREELLMAPI_MODEL;
  return {
    providerId: "freellmapi",
    modelId: model,
    url: env.FREELLMAPI_BASE_URL?.trim() || DEFAULT_FREELLMAPI_URL,
    apiKey,
  };
}

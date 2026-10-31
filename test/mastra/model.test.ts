import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveAgentModel } from "../../src/mastra/model.js";

describe("resolveAgentModel", () => {
  it("keeps the OpenAI model when FreeLLMAPI is not configured", () => {
    assert.equal(resolveAgentModel({}), "openai/gpt-6-luna");
  });

  it("routes through a local FreeLLMAPI router by default", () => {
    assert.deepEqual(resolveAgentModel({ FREELLMAPI_API_KEY: "freellmapi-key" }), {
      providerId: "freellmapi",
      modelId: "auto",
      url: "http://localhost:3001/v1",
      apiKey: "freellmapi-key",
    });
  });

  it("honours an explicit router URL and model", () => {
    assert.deepEqual(
      resolveAgentModel({
        FREELLMAPI_API_KEY: "freellmapi-key",
        FREELLMAPI_BASE_URL: "http://192.168.1.10:3001/v1",
        FREELLMAPI_MODEL: "auto:fast",
      }),
      {
        providerId: "freellmapi",
        modelId: "auto:fast",
        url: "http://192.168.1.10:3001/v1",
        apiKey: "freellmapi-key",
      },
    );
  });

  it("ignores a blank FreeLLMAPI key", () => {
    assert.equal(resolveAgentModel({ FREELLMAPI_API_KEY: "   " }), "openai/gpt-6-luna");
  });
});

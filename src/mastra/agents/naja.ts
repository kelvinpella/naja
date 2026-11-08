import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { memoryStorage } from "../storage.js";
import { resolveAgentModel } from "../model.js";
import { najaInstructions } from "./naja-instructions.js";
import { searchAgent } from "./search.js";
import { getJobTool } from "../tools/job-tools.js";

// Observational Memory compresses long threads into an observation log, so a
// person can keep messaging for months without the window filling with raw
// history. Temporal markers keep the pause between messages visible to the
// model: WhatsApp conversations routinely resume days later.
export const najaMemory = new Memory({
  storage: memoryStorage,
  options: {
    observationalMemory: {
      temporalMarkers: true,
    },
  },
});

export const najaAgent = new Agent({
  id: "naja",
  name: "Naja",
  instructions: najaInstructions,
  model: resolveAgentModel(),
  memory: najaMemory,
  // Delegation, not a direct tool: the job finder owns query understanding and
  // the search itself. The generated tool is `agent-search` (ADR 0010).
  agents: { search: searchAgent },
  // A tapped card opens one Job; that is a lookup, not a search.
  tools: { getJob: getJobTool },
});

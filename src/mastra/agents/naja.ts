import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { memoryStorage } from "../storage.js";
import { najaInstructions } from "./naja-instructions.js";

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
  model: "openai/gpt-6-luna",
  memory: najaMemory,
});

import { Mastra } from "@mastra/core";
import { najaAgent } from "./agents/naja.js";
import { memoryStorage } from "./storage.js";

// The agent runs as a library inside the BullMQ worker; this instance exists
// so the same wiring is visible to Mastra Studio and to future tools.
export const mastra = new Mastra({
  agents: { naja: najaAgent },
  storage: memoryStorage,
});

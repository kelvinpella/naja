import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { skillResultRedactor } from "@mastra/memory/hooks";
import { memoryStorage } from "../storage.js";
import { resolveAgentModel } from "../model.js";
import { najaInstructions } from "./naja-instructions.js";

// Mastra resolves a skill path against `process.cwd()` unless it is absolute,
// and a missing directory degrades silently to an empty catalog. Anchoring the
// path to this module makes it independent of where the worker was started:
// `dist/mastra/agents` sits at the same depth as `src/mastra/agents`.
const INTEGRATE_WHATSAPP_SKILL = fileURLToPath(
  new URL("../../../.agents/skills/integrate-whatsapp", import.meta.url),
);

if (!existsSync(INTEGRATE_WHATSAPP_SKILL)) {
  console.warn(
    `The integrate-whatsapp skill is missing at ${INTEGRATE_WHATSAPP_SKILL}; the agent will compose interactive payloads without its reference.`,
  );
}

// Observational Memory compresses long threads into an observation log, so a
// person can keep messaging for months without the window filling with raw
// history. Temporal markers keep the pause between messages visible to the
// model: WhatsApp conversations routinely resume days later.
export const najaMemory = new Memory({
  storage: memoryStorage,
  options: {
    observationalMemory: {
      temporalMarkers: true,
      // A loaded SKILL.md is reference material, not something the person said.
      // Redacting skill results keeps a whole document out of the Observations.
      hooks: { beforeObservation: skillResultRedactor() },
    },
  },
});

export const najaAgent = new Agent({
  id: "naja",
  name: "Naja",
  instructions: najaInstructions,
  model: resolveAgentModel(),
  memory: najaMemory,
  // The skill documents the interactive payloads the instructions require the
  // model to choose between; it loads on demand, so only its catalogue entry
  // sits in every prompt.
  skills: [INTEGRATE_WHATSAPP_SKILL],
});

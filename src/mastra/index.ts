import { Mastra } from "@mastra/core";
import {
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from "@mastra/observability";
import { najaAgent } from "./agents/naja.js";
import { memoryStorage } from "./storage.js";

// The agent runs as a library inside the BullMQ worker; this instance exists so
// the same wiring is visible to Mastra Studio and to future tools. Going
// through it is not optional: registration is what hands the agent the
// observability config, so `mastra.getAgent("naja")` is the traced path.
export const mastra = new Mastra({
  agents: { naja: najaAgent },
  storage: memoryStorage,
  // Studio serves the console and an unauthenticated REST API on this port,
  // including agent-generate and memory-write routes. Loopback only: a tunnel
  // to 4111 would expose real People's Conversations. See ADR 0004.
  server: { host: "127.0.0.1", port: 4111 },
  observability: new Observability({
    configs: {
      default: {
        serviceName: "naja",
        exporters: [
          // Spans land in `.data/mastra.db` beside Threads, which is what the
          // Studio Traces view reads.
          new MastraStorageExporter(),
        ],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

import { Agent } from "@mastra/core/agent";
import { resolveAgentModel } from "../model.js";
import {
  listRecentJobsTool,
  searchJobsTool,
} from "../tools/job-search-tools.js";
import { searchInstructions } from "./search-instructions.js";

/**
 * Naja's job finder: it owns query understanding (terms, both languages) and
 * reading the database, and nothing else. Deliberately without memory — the
 * delegation prompt is all the context it gets, so the Person's Thread stays
 * clean and a search run is repeatable (ADR 0010).
 */
export const searchAgent = new Agent({
  id: "search",
  name: "Job finder",
  description:
    "Finds published Jobs for what a Person needs, or lists the newest ones.",
  instructions: searchInstructions,
  model: resolveAgentModel(),
  tools: {
    searchJobs: searchJobsTool,
    listRecentJobs: listRecentJobsTool,
  },
});

# AGENTS Guidelines for This Repository

This repository contains a Fastify server application written in TypeScript. Please use the relevant skills when possible and follow the guidance below so the development workflow stays smooth and consistent.

## 1. Use the development server, not `npm run build`

- Always use `npm run dev` while iterating on the application.
- This starts Fastify in development mode.

## 2. Keep dependencies in sync

Whenever you add or update dependencies:

1. Update the appropriate lockfile: `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`.
2. Restart the development server so the app picks up the changes.

## 3. Coding conventions

- Consult the relevant Fastify, TypeScript, and other project skills when working on related tasks.
- Use TypeScript for all new utilities.
- Whenever an agent has skills or tools attached, name them in that agent's instructions (e.g. `src/mastra/agents/naja-instructions.ts`) and say when to reach for them. Mastra injects the skill catalogue and the tool list into the prompt, but the instructions are where the model learns that a capability exists and what it is for — an unnamed skill goes unused.

## 4. Prefer official SDKs over raw HTTP

- When an official SDK is available in the project (e.g. `@kapso/whatsapp-cloud-api` for WhatsApp, `@supabase/supabase-js` for Supabase), always use it instead of hand-rolled `fetch` calls.
- If the SDK is not yet installed, add it with the appropriate package manager and update the lockfile (see section 2).
- Only fall back to raw HTTP when the SDK lacks the needed endpoint or option — and leave a comment explaining why.

## 5. Never commit unless told

- Do not commit, amend, push, or create PRs unless the user explicitly asks.
- Leave changes uncommitted in the working tree for the user to review.

## 6. PRs must be descriptive

- Every PR title names the change and its scope.
- Every PR description includes: what changed, why, key behavior/implementation notes, how it was verified (typecheck/tests), and follow-ups if any.
- Link related issues or specs when they exist.

## 7. Free ports when you are done

- Any server or Studio session you start is your responsibility: stop it before you finish the task. That includes Fastify (`PORT`, default `3000`) and Mastra Studio (`127.0.0.1:4111`).
- Do not leave a server running in the background across turns or sessions. A port left bound makes the next run fail or silently talk to a stale process.
- Before starting a server, check the port and clear it instead of layering a second instance on top: `lsof -nP -iTCP:4111 -sTCP:LISTEN`.
- If a process genuinely has to outlive the session, say so and name the process and port, so the user can stop it.

## 8. Ask one question at a time

- When a decision is needed, ask a single question and wait for the answer before asking the next.
- Hold the remaining open questions until that answer lands.
- Look facts up yourself; decisions are the user's.

## 9. Useful command recap

| Command | Purpose |
| --- | --- |
| `npm install` | Install project dependencies and packages |
| `npm run dev` | Start the Fastify server |
| `npm run lint` | Run ESLint checks |
| `npm run test` | Execute the test suite (if present) |
| `npm run build` | Production build — do not run during agent sessions |
| `lsof -nP -iTCP:<port> -sTCP:LISTEN` | Show which process holds a port before starting a server |

---

Following these practices keeps the agent-assisted workflow fast and dependable. When in doubt, restart the development server rather than running the production build.

---

## Agent skills

### Issue tracker

Issues are tracked as GitHub issues in `kelvinpella/naja`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, with label strings equal to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
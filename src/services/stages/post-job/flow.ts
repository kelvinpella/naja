import { unwrapFlowPayload } from "../flow-payload.js";
import { createDraftFlow } from "../draft-flow.js";

// Draft-only Flow JSON for posting a job (Tangaza kazi).
// Lifecycle: DRAFT -> upload JSON -> send with draft:true for testing.
// Never published by this codebase.
// Screen 1 (DETAILS): title, description, area, budget. Button: Endelea.
// Screen 2 (PICHA): optional single PhotoPicker, camera + gallery. Gallery
// HEIC never leaves the phone in complete-mode Flows (silent client block,
// see issue #5), so the description warns users to switch to JPG/PNG.
// Button: Tangaza.
export const POST_JOB_FLOW_NAME = "tangaza_kazi";
export const POST_JOB_FLOW_CATEGORIES = ["SURVEY"] as const;
export const POST_JOB_FLOW_SCREEN = "DETAILS";
export const POST_JOB_FLOW_CTA = "Weka Tangazo";

export const POST_JOB_FLOW_JSON = {
  version: "7.1",
  screens: [
    {
      id: "DETAILS",
      title: "Tangaza kazi",
      terminal: false,
      data: {
        init_values: {
          type: "object",
          __example__: {
            title: "Mpishi wa pilau anahitajika",
            description: "Nahitaji mpishi wa pilau weekend",
            area: "Mbezi, Dar es Salaam",
            budget: "50000",
          },
        },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          {
            type: "Form",
            name: "details_form",
            ["init-values"]: "${data.init_values}",
            children: [
              {
                type: "TextHeading",
                text: "Tangaza kazi",
              },
              {
                type: "TextInput",
                label: "Jina la kazi",
                required: true,
                name: "title",
                ["input-type"]: "text",
                ["max-chars"]: 80,
                ["helper-text"]: "Mpishi wa pilau anahitajika",
              },
              {
                type: "TextArea",
                label: "Maelezo",
                required: true,
                name: "description",
                ["max-length"]: 500,
                ["helper-text"]: "Eleza kazi kwa kifupi",
              },
              {
                type: "TextInput",
                label: "Eneo",
                required: true,
                name: "area",
                ["input-type"]: "text",
                ["max-chars"]: 80,
                ["helper-text"]: "Mfano: Mbezi, Dar es Salaam",
              },
              {
                type: "TextInput",
                label: "Bajeti(Tsh)",
                required: true,
                name: "budget",
                ["input-type"]: "number",
                ["helper-text"]: "Mfano: 50000",
              },
              {
                type: "Footer",
                label: "Endelea",
                ["on-click-action"]: {
                  name: "navigate",
                  next: { type: "screen", name: "PICHA" },
                  payload: {
                    title: "${form.title}",
                    description: "${form.description}",
                    area: "${form.area}",
                    budget: "${form.budget}",
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: "PICHA",
      title: "Weka picha ya kazi",
      terminal: true,
      data: {
        title: {
          type: "string",
          __example__: "Mpishi wa pilau anahitajika",
        },
        description: {
          type: "string",
          __example__: "Nahitaji mpishi wa pilau weekend",
        },
        area: {
          type: "string",
          __example__: "Mbezi, Dar es Salaam",
        },
        budget: {
          type: "string",
          __example__: "50000",
        },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          {
            type: "Form",
            name: "photo_form",
            children: [
              {
                type: "TextHeading",
                text: "Weka picha ya kazi",
              },
              {
                type: "PhotoPicker",
                name: "job_image",
                label: "Weka picha ya kazi",
                description: "Mfano: picha ya eneo la kusafishwa. Ukiona picha .HEIC, badili. Weka JPG/PNG",
                ["photo-source"]: "camera_gallery",
                ["max-file-size-kb"]: 5120,
                ["min-uploaded-photos"]: 0,
                ["max-uploaded-photos"]: 1,
              },
              {
                type: "Footer",
                label: "Tangaza",
                ["on-click-action"]: {
                  name: "complete",
                  payload: {
                    title: "${data.title}",
                    description: "${data.description}",
                    area: "${data.area}",
                    budget: "${data.budget}",
                    job_image: "${form.job_image}",
                  },
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

export function getPostJobFlowId(): string | undefined {
  return process.env["ZERNIO_TANGAZA_FLOW_ID"];
}

export type PostJobFlowMedia = {
  file_name?: unknown;
  mime_type?: unknown;
  cdn_url?: unknown;
  media_id?: unknown;
  id?: unknown;
  encryption_metadata?: unknown;
};

export type PostJobSubmit = {
  title?: unknown;
  description?: unknown;
  area?: unknown;
  budget?: unknown;
  job_image?: unknown;
  raw: unknown;
};

// Uses official @zernio/node SDK via the shared draft helper. Creates a
// DRAFT and uploads JSON. Never calls publish — stays DRAFT for testing.
export async function createPostJobDraftFlow(
  accountId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ flowId: string; reused: boolean }> {
  return createDraftFlow(
    {
      name: POST_JOB_FLOW_NAME,
      categories: POST_JOB_FLOW_CATEGORIES,
      flowJson: POST_JOB_FLOW_JSON,
      logTag: "post-job-flow",
    },
    accountId,
    apiKey,
    signal,
  );
}

export function parsePostJobResponse(responseData: unknown): PostJobSubmit {
  const record =
    typeof responseData === "object" && responseData !== null
      ? (responseData as Record<string, unknown>)
      : {};
  return {
    title: record["title"],
    description: record["description"],
    area: record["area"],
    budget: record["budget"],
    job_image: record["job_image"],
    raw: responseData,
  };
}

// Adapter entry: unwrap wire shape then parse, so callers never touch
// response_json plumbing.
export function parsePostJobFlowPayload(raw: unknown): PostJobSubmit {
  return parsePostJobResponse(unwrapFlowPayload(raw));
}

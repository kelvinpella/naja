// Draft-only Flow JSON for posting a job.
// Authored in camelCase: the Kapso SDK converts it to Meta's wire case and
// throws on snake_case keys (see ADR 0006).
// Screen 1 (DETAILS): title, description, area, budget. Button: Endelea.
// Screen 2 (PICHA): optional single PhotoPicker. Button: Tangaza.
export const POST_JOB_FLOW_NAME = "naja_post_job";
export const POST_JOB_FLOW_CATEGORIES = ["SURVEY"] as const;
export const POST_JOB_FLOW_START_SCREEN = "DETAILS";
export const POST_JOB_FLOW_CTA = "Tangaza kazi";

// The token is how the completion finds its way back to this code without any
// conversation state: `post_job:<personKey>`.
export const POST_JOB_FLOW_TOKEN_PREFIX = "post_job:";

export function postJobFlowToken(personKey: string): string {
  return `${POST_JOB_FLOW_TOKEN_PREFIX}${personKey}`;
}

export function isPostJobFlowToken(token: string | undefined): boolean {
  return token?.startsWith(POST_JOB_FLOW_TOKEN_PREFIX) ?? false;
}

export const POST_JOB_FLOW_JSON = {
  version: "7.1",
  screens: [
    {
      id: "DETAILS",
      title: "Tangaza kazi",
      terminal: false,
      data: {
        initValues: {
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
            name: "detailsForm",
            initValues: "${data.initValues}",
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
                inputType: "text",
                maxChars: 80,
                helperText: "Mpishi wa pilau anahitajika",
              },
              {
                type: "TextArea",
                label: "Maelezo",
                required: true,
                name: "description",
                maxLength: 500,
                helperText: "Eleza kazi kwa kifupi",
              },
              {
                type: "TextInput",
                label: "Eneo",
                required: true,
                name: "area",
                inputType: "text",
                maxChars: 80,
                helperText: "Mfano: Mbezi, Dar es Salaam",
              },
              {
                type: "TextInput",
                label: "Bajeti(Tsh)",
                required: true,
                name: "budget",
                inputType: "number",
                helperText: "Mfano: 50000",
              },
              {
                type: "Footer",
                label: "Endelea",
                onClickAction: {
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
        title: { type: "string", __example__: "Mpishi wa pilau anahitajika" },
        description: {
          type: "string",
          __example__: "Nahitaji mpishi wa pilau weekend",
        },
        area: { type: "string", __example__: "Mbezi, Dar es Salaam" },
        budget: { type: "string", __example__: "50000" },
      },
      layout: {
        type: "SingleColumnLayout",
        children: [
          {
            type: "Form",
            name: "photoForm",
            children: [
              {
                type: "TextHeading",
                text: "Weka picha ya kazi",
              },
              {
                type: "PhotoPicker",
                name: "jobImage",
                label: "Weka picha ya kazi",
                description:
                  "Mfano: picha ya eneo la kusafishwa. JPG/PNG, max 5MB. iPhone (HEIC): Settings > Camera > Formats > Most Compatible",
                photoSource: "camera_gallery",
                maxFileSizeKb: 5120,
                minUploadedPhotos: 0,
                maxUploadedPhotos: 1,
              },
              {
                type: "Footer",
                label: "Tangaza",
                onClickAction: {
                  name: "complete",
                  payload: {
                    title: "${data.title}",
                    description: "${data.description}",
                    area: "${data.area}",
                    budget: "${data.budget}",
                    jobImage: "${form.jobImage}",
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
  const flowId = process.env["KAPSO_POST_JOB_FLOW_ID"]?.trim();
  return flowId || undefined;
}

export type PostJobMedia = {
  id?: unknown;
  media_id?: unknown;
  // Meta sends snake_case; Kapso's read-back API camel-cases it.
  mime_type?: unknown;
  mimeType?: unknown;
  file_name?: unknown;
  fileName?: unknown;
};

export type PostJobFields = {
  title: string;
  description: string;
  area: string;
  budget: number;
};

export type PostJobDetails = PostJobFields & {
  jobImage: unknown;
};

export type PostJobSubmit = {
  title?: unknown;
  description?: unknown;
  area?: unknown;
  budget?: unknown;
  jobImage?: unknown;
  raw: unknown;
};

/**
 * The Flow enforces required fields and lengths, so these checks only catch a
 * draft whose JSON drifted or a hand-crafted payload. A failure is not
 * retried: the same payload would fail again.
 */
export function validatePostJobSubmission(
  responseData: unknown,
): PostJobDetails | null {
  const submit = parsePostJobResponse(responseData);
  const text = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";
  const title = text(submit.title);
  const description = text(submit.description);
  const area = text(submit.area);
  const budgetRaw =
    typeof submit.budget === "string" || typeof submit.budget === "number"
      ? String(submit.budget).trim()
      : "";
  const budget = Number(budgetRaw);

  if (!title || title.length > 80) return null;
  if (!description || description.length > 500) return null;
  if (!area || area.length > 80) return null;
  if (!budgetRaw || !Number.isFinite(budget) || budget <= 0 || budget > 999_999_999) {
    return null;
  }

  return {
    title,
    description,
    area,
    budget: Math.floor(budget),
    jobImage: submit.jobImage,
  };
}

// The three messages a Posting can produce, all fixed Swahili constants: the
// Person is told at submission, at publication, and after the last failed
// attempt (ADR 0007).
export function postJobReceipt(title: string): string {
  return `✅ Tumepokea tangazo lako: *${title}*.\nTunaliangalia; tutakujulisha likishachapishwa.`;
}

export function postJobPublished(title: string): string {
  return `🎉 Tangazo lako *${title}* limechapishwa.`;
}

export const POST_JOB_FAILED_BODY =
  "Samahani, tangazo lako halikuchapishwa kwa sasa. Taarifa zako zimehifadhiwa — bonyeza hapa chini kujaribu tena.";

/**
 * The fields a re-sent Form arrives filled with. The Flow reads them as
 * `${data.initValues}`, so they travel under that key in the send's
 * `flowActionPayload.data`. The photo is not here: it cannot be prefilled and
 * has to be picked again.
 */
export function postJobFlowPrefill(details: PostJobFields): Record<string, string> {
  return {
    title: details.title,
    description: details.description,
    area: details.area,
    budget: String(details.budget),
  };
}

/**
 * The Flow hands its payload back as a JSON string, sometimes already parsed,
 * and older drafts named the photo field `job_image`. Accept both spellings so
 * an already-deployed draft keeps working.
 */
export function parsePostJobResponse(responseData: unknown): PostJobSubmit {
  let payload = responseData;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      payload = undefined;
    }
  }
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  return {
    title: record["title"],
    description: record["description"],
    area: record["area"],
    budget: record["budget"],
    jobImage: record["jobImage"] ?? record["job_image"],
    raw: payload,
  };
}

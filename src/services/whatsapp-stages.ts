import { GET_STARTED_MESSAGE } from "./stages/get-started/message.js";
import { FIND_JOB_MESSAGE } from "./stages/find-job/message.js";
import { FIND_JOB_SEARCH_MESSAGE } from "./stages/find-job/search.js";
import { FIND_JOB_MIXED_MESSAGE } from "./stages/find-job/mixed.js";
import { POST_JOB_MESSAGE } from "./stages/post-job/message.js";
import { TERMS_MESSAGE } from "./stages/terms/message.js";
import { JOB_DETAIL_MESSAGE } from "./stages/job-detail/message.js";
import { JOB_APPLY_MESSAGE } from "./stages/job-apply/message.js";

export type {
  StageId,
  StageButton,
  StageFlow,
  StageMessage,
} from "./stages/stage-types.js";
export { BACK_BUTTON } from "./stages/stage-types.js";
import type { StageId, StageMessage } from "./stages/stage-types.js";

export const STAGE_MESSAGES: Record<StageId, StageMessage> = {
  get_started: GET_STARTED_MESSAGE,
  tafuta_kazi: FIND_JOB_MESSAGE,
  tafuta_kazi_search: FIND_JOB_SEARCH_MESSAGE,
  tafuta_kazi_mixed: FIND_JOB_MIXED_MESSAGE,
  tangaza_kazi: POST_JOB_MESSAGE,
  vigezo_na_masharti: TERMS_MESSAGE,
  job_detail: JOB_DETAIL_MESSAGE,
  job_apply: JOB_APPLY_MESSAGE,
};

const STAGE_IDS: ReadonlySet<string> = new Set(Object.keys(STAGE_MESSAGES));

export function isStageId(value: string | undefined): value is StageId {
  return typeof value === "string" && STAGE_IDS.has(value);
}

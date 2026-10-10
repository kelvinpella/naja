import type { StageMessage } from "../stage-types.js";
import { BACK_BUTTON } from "../stage-types.js";

// Static fallback — live detail always renders via fullDetailBody() with
// per-job Omba/Rudi buttons. This copy only shows if the listing was deleted.
export const JOB_DETAIL_MESSAGE: StageMessage = {
  body: [
    "*Maelezo ya kazi*",
    "",
    "Samahani, kazi hiyo haikupatikana. Chagua kazi nyingine au rudi kwenye menyu kuu.",
  ].join("\n"),
  buttons: [BACK_BUTTON],
};

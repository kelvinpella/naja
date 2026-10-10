import type { StageMessage } from "../stage-types.js";
import { BACK_BUTTON } from "../stage-types.js";

// Static fallback — live apply always renders via applyConfirmationBody()
// with the poster's contact. This copy only shows for direct stage taps.
export const JOB_APPLY_MESSAGE: StageMessage = {
  body: "Ombi limepokelewa. Chagua kazi yenye maelezo kamili ili kupata mawasiliano ya muajiri, au rudi kwenye menyu kuu.",
  buttons: [{ type: "postback", title: "Tafuta kazi", payload: "tafuta_kazi" }, BACK_BUTTON],
};

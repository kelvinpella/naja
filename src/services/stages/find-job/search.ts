import type { StageMessage } from "../stage-types.js";
import { BACK_BUTTON, flowMode } from "../stage-types.js";
import { FIND_JOB_SEARCH_FLOW_CTA, FIND_JOB_SEARCH_FLOW_SCREEN } from "./flow.js";

export const FIND_JOB_SEARCH_MESSAGE: StageMessage = {
  body: "Andika jina la kazi unayoitaka, kisha bofya *Tafuta* kufungua fomu ya kutafuta.",
  buttons: [BACK_BUTTON],
  flow: {
    cta: FIND_JOB_SEARCH_FLOW_CTA,
    screen: FIND_JOB_SEARCH_FLOW_SCREEN,
    mode: flowMode(),
  },
};

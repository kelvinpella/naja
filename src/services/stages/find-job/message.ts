import type { StageMessage } from "../stage-types.js";
import { BACK_BUTTON } from "../stage-types.js";

export const FIND_JOB_BANNER_URL =
  "https://res.cloudinary.com/dpw2dpthx/image/upload/v1791161180/tafuta_kazi_banner_iw3axp.jpg";

export const FIND_JOB_MESSAGE: StageMessage = {
  body: [
    "*Maelezo*",
    "",
    "1. Bofya *Andika jina la kazi* kama unahitaji kutafuta kwa kuandika jina la kazi unayoitaka.",
    "",
    // Body keeps the full "Kazi mpya mchanganyiko" phrase; the button is shortened
    // to "Kazi mchanganyiko" for Meta's 20-char reply-button limit. Routing is payload-only.
    "2. Bofya *Kazi mpya mchanganyiko* kama unahitaji kuona kazi mchanganyiko zote zilizotangazwa hivi karibuni.",
    "",
    "3. Bofya *Rudi nyuma* kama unahitaji kurudi kwenye menyu kuu.",
  ].join("\n"),
  imageUrl: FIND_JOB_BANNER_URL,
  imageType: "image",
  buttons: [
    { type: "postback", title: "Andika jina la kazi", payload: "tafuta_kazi_search" },
    // "Kazi mpya mchanganyiko" is 21 chars; Meta reply-button titles max out
    // at 20, so the button uses the shortened label (body keeps the full phrase).
    { type: "postback", title: "Kazi mchanganyiko", payload: "tafuta_kazi_mixed" },
    BACK_BUTTON,
  ],
};

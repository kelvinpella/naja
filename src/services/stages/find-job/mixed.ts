import type { StageMessage } from "../stage-types.js";
import { BACK_BUTTON } from "../stage-types.js";
import { FIND_JOB_BANNER_URL } from "./message.js";

export const FIND_JOB_MIXED_MESSAGE: StageMessage = {
  body: [
    "*Kazi mchanganyiko*",
    "",
    "Hizi ni kazi zilizotangazwa hivi karibuni. Orodha kamili hutumwa kama ujumbe unaofuata.",
    "",
    "Bofya *Andika jina la kazi* kutafuta kwa jina, au *Rudi nyuma* kurudi kwenye menyu kuu.",
  ].join("\n"),
  imageUrl: FIND_JOB_BANNER_URL,
  imageType: "image",
  buttons: [
    { type: "postback", title: "Andika jina la kazi", payload: "tafuta_kazi_search" },
    BACK_BUTTON,
  ],
};

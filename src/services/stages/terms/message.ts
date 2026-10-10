import type { StageMessage } from "../stage-types.js";
import { BACK_BUTTON } from "../stage-types.js";

export const TERMS_BANNER_URL =
  process.env["NAJA_TERMS_BANNER_URL"] ??
  "https://res.cloudinary.com/dpw2dpthx/image/upload/v1791504314/image_20261009_030328_pi1ncm.jpg";

export const TERMS_MESSAGE: StageMessage = {
  body: [
    "*Vigezo na Masharti ya Naja*",
    "",
    "Kwa kutumia Naja unakubali sheria zifuatazo:",
    "",
    "1. Lazima uwe na umri wa miaka 18 au zaidi.",
    "",
    "2. Hakuna picha za utupu au maudhui ya ngono.",
    "",
    "3. Hakuna shughuli haramu, utapeli au kamari.",
    "",
    "4. Hakuna matusi, ubaguzi au unyanyasaji.",
    "",
    "5. Tangaza kazi halali tu; weka mshahara wazi; usitoze ada ya mbele.",
    "",
    "6. Usitume nenosiri, OTP au taarifa za siri za watu wengine.",
    "",
    "7. Admin anaweza kufuta tangazo na kumzuia mkiukaji.",
    "",
    "8. Ukiona ukiukaji, tuma ujumbe mpya hapa ukieleza tatizo (majibu ya ujumbe huu hufungua menyu upya).",
    "",
    "Ukiendelea kutumia Naja, unakubali vigezo hivi.",
  ].join("\n"),
  // Verified 2026-10-09: 200 + image/jpeg, 53KB.
  imageUrl: TERMS_BANNER_URL,
  imageType: "image",
  buttons: [BACK_BUTTON],
};

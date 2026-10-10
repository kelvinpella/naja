import type { StageMessage } from "../stage-types.js";

export const GET_STARTED_BANNER_URL =
  process.env["NAJA_GET_STARTED_BANNER_URL"] ??
  "https://res.cloudinary.com/dpw2dpthx/image/upload/v1791069460/Naja_get_started_banner_caezkp.jpg";

export const GET_STARTED_MESSAGE: StageMessage = {
  body: [
    "Karibu! Naja ni kwa ajili ya matangazo ya kazi ndogo ndogo za nyumbani kama *upishi*, *kufua*, *ufundi* n.k. kwa njia ya WhatsApp.",
    "",
    "1. Bofya *Tafuta kazi* kama unahitaji kuona na kuomba baadhi ya kazi zilizotangazwa.",
    "",
    "2. Bofya *Tangaza kazi* kama unahitaji kuweka tangazo lako la kazi.",
    "",
    "3. Bofya *Vigezo na Masharti* kama unahitaji kufahamu sheria za kutumia Naja.",
  ].join("\n"),
  // Banner verified 2026-10-07: 200 + image/jpeg. If this URL ever dies,
  // Meta fails delivery async (131053) with no send-time error, so verify
  // before swapping (curl -sI) rather than relying on the image fallback.
  imageUrl: GET_STARTED_BANNER_URL,
  imageType: "image",
  buttons: [
    { type: "postback", title: "Tafuta kazi", payload: "tafuta_kazi" },
    { type: "postback", title: "Tangaza kazi", payload: "tangaza_kazi" },
    { type: "postback", title: "Vigezo na Masharti", payload: "vigezo_na_masharti" },
  ],
};

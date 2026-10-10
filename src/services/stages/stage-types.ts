// Stage IDs mix Swahili menu slugs (get_started/tafuta/tangaza/vigezo) with
// English dynamic routes (job_detail/job_apply). Kept intentionally: payloads
// on the wire already use these strings — renaming would orphan old card taps.
export type StageId =
  | "get_started"
  | "tafuta_kazi"
  | "tafuta_kazi_search"
  | "tafuta_kazi_mixed"
  | "tangaza_kazi"
  | "vigezo_na_masharti"
  | "job_detail"
  | "job_apply";

export type StageButton = {
  type: "postback";
  title: string;
  payload: string;
};

export type StageFlow = {
  cta: string;
  screen: string;
  mode: "draft" | "published";
};

export type StageMessage = {
  body: string;
  imageUrl?: string;
  imageType?: "image" | "video" | "audio" | "file";
  buttons: StageButton[];
  flow?: StageFlow;
};

export const BACK_BUTTON: StageButton = Object.freeze({
  type: "postback",
  title: "Rudi nyuma",
  payload: "get_started",
}) as StageButton;

export function flowMode(): "draft" | "published" {
  return process.env["ZERNIO_FLOW_MODE"] === "published" ? "published" : "draft";
}

// heic-convert@2.1.0 ships no types — local shim (checked 2026-10-10, no
// "types"/"typings" in its package.json). Keep minimal and scoped.
declare module "heic-convert" {
  export default function convert(options: {
    buffer: Uint8Array | Buffer | ArrayBuffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }): Promise<Uint8Array>;
}

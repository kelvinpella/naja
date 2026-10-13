// One Zernio client per apiKey. The client holds no per-request state
// (auth + idempotency travel per call), so sharing is safe and avoids
// re-auth setup on every send.
import { Zernio } from "@zernio/node";

const clients = new Map<string, Zernio>();

export function getZernioClient(apiKey: string): Zernio {
  const cached = clients.get(apiKey);
  if (cached) return cached;
  const client = new Zernio({ apiKey });
  clients.set(apiKey, client);
  return client;
}

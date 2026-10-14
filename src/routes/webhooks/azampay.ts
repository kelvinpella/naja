import type { FastifyPluginAsync } from "fastify";

// AzamPay sandbox callback (issue #24, minimal): AzamPay POSTs the MNO
// checkout result here and retries until it gets a 200. For the sandbox
// test we log the payload and ack fast; verification, dedupe, and token
// crediting belong to the full payment state machine (out of scope).
const azamPayWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/azampay", async (request, reply) => {
    request.log.info(
      { callback: request.body },
      "Received AzamPay callback",
    );
    return reply.code(200).send({ received: true });
  });
};

export default azamPayWebhookRoutes;

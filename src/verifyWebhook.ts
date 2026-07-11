import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an inbound ShieldLabs webhook signature.
 *
 * Compares `X-Shield-Signature` to `sha256=` + hex(HMAC-SHA256(secret, rawBody))
 * using a constant-time comparison. Pass the raw request body bytes exactly as
 * received — re-serializing parsed JSON will fail verification.
 */
export function verifyWebhook(
  rawBody: string | Buffer | Uint8Array,
  signatureHeader: string,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

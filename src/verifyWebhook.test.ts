import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { verifyWebhook } from "./verifyWebhook.js";

const SECRET = "whsec_test_secret";
const BODY = Buffer.from(
  JSON.stringify({
    event_type: "webhook.ping",
    schema_version: "2026-06-01",
    created_at: "2026-06-26T14:20:42Z",
  }),
);

function sign(secret: string, body: Buffer): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyWebhook", () => {
  it("accepts a valid signature", () => {
    assert.equal(verifyWebhook(BODY, sign(SECRET, BODY), SECRET), true);
  });

  it("accepts a string body matching the signed bytes", () => {
    const text = BODY.toString("utf8");
    assert.equal(verifyWebhook(text, sign(SECRET, Buffer.from(text)), SECRET), true);
  });

  it("rejects a wrong secret", () => {
    assert.equal(verifyWebhook(BODY, sign(SECRET, BODY), "other"), false);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(BODY.toString("utf8") + " ");
    assert.equal(verifyWebhook(tampered, sign(SECRET, BODY), SECRET), false);
  });

  it("rejects a missing header", () => {
    assert.equal(verifyWebhook(BODY, "", SECRET), false);
  });

  it("rejects a truncated signature (length mismatch)", () => {
    assert.equal(verifyWebhook(BODY, "sha256=ab", SECRET), false);
  });
});

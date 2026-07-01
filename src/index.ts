/**
 * @shieldlabs/node — server-side SDK.
 *
 * Talks to the ShieldLabs API and verifies inbound webhooks. Your code
 * decides what to do with the score: you set the rules. This SDK never
 * makes the decision for you.
 *
 * Status: pre-launch scaffold. The surface below is a placeholder and will
 * be finalized from the OpenAPI specification before the first release.
 */

export interface ShieldLabsClientOptions {
  /** Secret API key issued in the ShieldLabs dashboard. */
  apiKey: string;
  /** Optional API base URL. Defaults to the ShieldLabs API. */
  baseUrl?: string;
}

export class ShieldLabsClient {
  constructor(private readonly options: ShieldLabsClientOptions) {}

  /** Fetch a stored identification result by request id. Not implemented yet. */
  async getResult(_requestId: string): Promise<unknown> {
    throw new Error("@shieldlabs/node is not published yet. See https://shieldlabs.ai");
  }
}

/**
 * Verify the signature of an inbound ShieldLabs webhook.
 * Not implemented yet.
 */
export function verifyWebhook(_payload: string, _signature: string, _secret: string): boolean {
  throw new Error("@shieldlabs/node is not published yet.");
}

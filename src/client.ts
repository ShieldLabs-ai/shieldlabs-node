export interface ShieldLabsClientOptions {
  /** Secret API key issued in the ShieldLabs dashboard. */
  apiKey: string;
  /** Optional API base URL. Defaults to the ShieldLabs History API. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://account.shieldlabs.ai/api";

/**
 * Thin client for ShieldLabs server APIs.
 * History reads target account.shieldlabs.ai (Shield.Portal.Admin).
 */
export class ShieldLabsClient {
  readonly apiKey: string;
  readonly baseUrl: string;

  constructor(options: ShieldLabsClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Fetch history by identifier.
   * GET /api/v1/history/{search_type}/{value} → { data, total }
   */
  async getHistory(
    searchType: string,
    value: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<{ data: unknown[]; total: number }> {
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, "")}/api/v1/history/${encodeURIComponent(searchType)}/${encodeURIComponent(value)}`,
    );
    if (opts?.limit != null) url.searchParams.set("limit", String(opts.limit));
    if (opts?.offset != null) url.searchParams.set("offset", String(opts.offset));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`ShieldLabs History API error: ${res.status}`);
    }
    return (await res.json()) as { data: unknown[]; total: number };
  }
}

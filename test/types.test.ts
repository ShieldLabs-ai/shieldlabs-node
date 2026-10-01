// Compile-time checks: `npm run typecheck` fails when a public type drifts.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  evaluateIdentification,
  riskBand,
  webhooks,
  type Evaluation,
  type FetchLike,
  type IdentificationScoredEvent,
  type LookupType,
  type RiskBand,
  type ShieldLabs,
  type ShieldLabsOptions,
  type UnknownWebhookEvent,
  type WebhookEvent,
  type WebhookPingEvent,
} from '../src/index.js';
import { loadText } from './helpers.js';

function describeEvent(event: WebhookEvent): string {
  switch (event.event_type) {
    case 'identification.scored':
      expectTypeOf(event).toEqualTypeOf<IdentificationScoredEvent>();
      return `scored ${event.data.request_id}`;
    case 'webhook.ping':
      expectTypeOf(event).toEqualTypeOf<WebhookPingEvent>();
      return 'ping';
    default:
      expectTypeOf(event).toEqualTypeOf<UnknownWebhookEvent>();
      return `unknown ${String(event.event_type)}`;
  }
}

describe('public types', () => {
  it('narrow webhook events by event_type, keeping unknown events in the default branch', () => {
    const body = loadText('webhook-ping.raw.txt');
    const event = webhooks.constructEvent(
      body,
      'sha256=ea2685733d254f7028fb031c4214583b0650de01e6c8c93131236024edd9fdd8',
      'whsec_00112233445566778899aabbccddeeff',
    );
    expect(describeEvent(event)).toBe('ping');
    expectTypeOf<UnknownWebhookEvent['event_type']>().toExtend<string>();
  });

  it('describe the risk helpers', () => {
    expectTypeOf(riskBand).returns.toEqualTypeOf<RiskBand | 'rate_limited'>();
    expectTypeOf(evaluateIdentification).returns.toEqualTypeOf<Evaluation>();
    expectTypeOf<Evaluation['reason']>().toEqualTypeOf<
      | 'missing'
      | 'replayed'
      | 'stale'
      | 'rate_limited'
      | 'no_device_signals'
      | 'blocked_flag'
      | 'blocked_band'
      | null
    >();
  });

  it('accept the global fetch and explicit undefined options', () => {
    expectTypeOf(globalThis.fetch).toExtend<FetchLike>();
    const options: ShieldLabsOptions = {
      apiKey: 'sec_your_private_key',
      baseUrl: undefined,
      timeout: undefined,
      maxRetries: undefined,
      fetch: undefined,
      allowInsecureHttp: undefined,
    };
    expect(options.apiKey).toBe('sec_your_private_key');
  });

  it('type the History methods', () => {
    expectTypeOf<Parameters<ShieldLabs['history']['search']>[0]>().toEqualTypeOf<LookupType>();
    expectTypeOf<ReturnType<ShieldLabs['history']['iterate']>>().toExtend<AsyncIterable<unknown>>();
  });
});

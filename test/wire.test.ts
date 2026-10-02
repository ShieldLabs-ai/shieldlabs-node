import { describe, expect, expectTypeOf, it } from 'vitest';
import type { LOOKUP_TYPES } from '../src/constants.js';
import type { operations } from '../src/generated/api.js';
import type {
  DetectionFlags,
  DomainProfile,
  HistoryPage,
  Identification,
  IdentificationScoredEvent,
  IdentificationSignal,
  LookupType,
  SearchOptions,
  ShieldLabs,
  ShieldLabsManagementOptions,
  WebhookPingEvent,
} from '../src/index.js';
import type {
  HistoryPath,
  HistoryQuery,
  HistoryResponse,
  HistoryRow,
  ProfileResponse,
  ScoredData,
  WireKeys,
} from '../src/wire.js';
import historyPage from './data/history-page.json';
import profile from './data/management-profile.json';
import scored from './data/webhook-identification-scored.json';
import ping from './data/webhook-ping.json';
import { fromHistoryRow, fromWebhookData } from '../src/normalize.js';

describe('generated wire types', () => {
  it('drive the supported History parameters and Management header', () => {
    expectTypeOf<LookupType>().toEqualTypeOf<HistoryPath['search_type']>();
    expectTypeOf<(typeof LOOKUP_TYPES)[number]>().toEqualTypeOf<LookupType>();
    expectTypeOf<Parameters<ShieldLabs['history']['search']>[1]>().toEqualTypeOf<
      HistoryPath['value']
    >();
    expectTypeOf<SearchOptions['limit']>().toEqualTypeOf<HistoryQuery['limit']>();
    expectTypeOf<SearchOptions['offset']>().toEqualTypeOf<HistoryQuery['offset']>();
    expectTypeOf<ShieldLabsManagementOptions['domain']>().toEqualTypeOf<
      operations['getDomainProfile']['parameters']['header']['X-Shield-Domain']
    >();
  });

  it('derive response fields while retaining the normalized public models', () => {
    expectTypeOf<HistoryPage['total']>().toEqualTypeOf<HistoryResponse['total']>();
    expectTypeOf<HistoryPage['data'][number]>().toEqualTypeOf<Identification>();
    expectTypeOf<DomainProfile['remaining_identifications']>().toEqualTypeOf<
      ProfileResponse['Weight']
    >();
    expectTypeOf<DetectionFlags>().toEqualTypeOf<ScoredData['detection_flags']>();
    expectTypeOf<IdentificationSignal['weight']>().toEqualTypeOf<
      ScoredData['signals'][number]['weight']
    >();
    expectTypeOf<IdentificationSignal['description']>().toEqualTypeOf<string | null>();
    expectTypeOf<Identification['observed_at']>().toEqualTypeOf<ScoredData['observed_at'] | null>();
    expectTypeOf<
      IdentificationScoredEvent['event_type']
    >().toEqualTypeOf<'identification.scored'>();
    expectTypeOf<WebhookPingEvent['event_type']>().toEqualTypeOf<'webhook.ping'>();
    expectTypeOf<WireKeys<HistoryRow, number>>().toEqualTypeOf<'score' | 'ver'>();
    expectTypeOf<'future_field'>().not.toExtend<WireKeys<HistoryRow>>();
  });

  it('accept recorded wire responses as input to the normalizers', () => {
    const page: HistoryResponse = historyPage;
    const domain: ProfileResponse = profile;
    const data: ScoredData = scored.data;
    expect(page.data.map(fromHistoryRow)).toHaveLength(historyPage.data.length);
    expect(domain.Weight).toBe(profile.Weight);
    expect(fromWebhookData(data).risk_score).toBe(data.risk_score);
    // JSON imports widen string literals, so narrow only the two event discriminants.
    const event = {
      ...scored,
      event_type: 'identification.scored' as const,
    } satisfies operations['identificationScored']['requestBody']['content']['application/json'];
    const pingEvent = {
      ...ping,
      event_type: 'webhook.ping' as const,
    } satisfies operations['webhookPing']['requestBody']['content']['application/json'];
    expect(event.data).toBe(scored.data);
    expect(pingEvent.event_type).toBe('webhook.ping');
  });
});

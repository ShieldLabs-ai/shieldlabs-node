import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromHistoryRow, fromWebhookData } from '../src/normalize.js';
const fixture = JSON.parse(readFileSync('test-data-client-identity.json', 'utf8')) as Record<
  string,
  unknown
>;
describe('scoped client identity', () => {
  it('keeps both surfaces equal without promoting provider proof to agent proof', () => {
    const history = fromHistoryRow({ score: 70, client_identity: fixture });
    const webhook = fromWebhookData({ risk_score: 70, client_identity: fixture });
    expect(history.client_identity).toEqual(webhook.client_identity);
    expect(history.client_identity?.verified[0]?.subject).toBe('provider');
    expect(history.client_identity?.claims[0]?.agent_name).toBe('GPTBot');
    expect(history.risk_score).toBe(70);
    expect(history.detection_flags.search_bot).toBe(false);
  });
  it('retains future values and leaves malformed/absent data unavailable', () => {
    const future = { ...fixture, availability: 'future_state', extra: 'kept' };
    expect(fromHistoryRow({ client_identity: future }).client_identity).toEqual(future);
    for (const value of [undefined, null, 'bad', {}]) {
      expect(fromHistoryRow({ client_identity: value }).client_identity).toBeUndefined();
    }
  });
});

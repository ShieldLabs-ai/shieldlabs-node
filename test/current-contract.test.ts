import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ShieldLabs, VERSION, webhooks } from '../src/index.js';
import * as edge from '../src/edge.js';
import { loadJson, TEST_API_KEY } from './helpers.js';

const fixture = loadJson<Record<string, any>>('webhook-current-contract.json');
const secret = 'whsec_fixture_current_contract';
const body = JSON.stringify(fixture);
const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('current public wire contract packaged installation regression', () => {
  it('preserves the current identification and envelope IDs after signature verification', () => {
    const event = webhooks.constructEvent(body, signature, secret);
    expect(event.event_type).toBe('identification.scored');
    if (event.event_type !== 'identification.scored') throw new Error('wrong event type');
    expect(event.data.identification_id).toBe(fixture.data.identification_id);
    expect(event.data.identification_id).not.toBe('');
    expect(event.raw.event_id).toBe(fixture.event_id);
    expect(event.raw).toEqual(fixture);
  });

  it('preserves current public flags in both Node and edge builds', async () => {
    const current = {
      ...fixture,
      data: {
        ...fixture.data,
        detection_flags: {
          ...fixture.data.detection_flags,
          ai_browser: true,
          network_check_incomplete: true,
        },
      },
    };
    const text = JSON.stringify(current);
    const signed = 'sha256=' + createHmac('sha256', secret).update(text).digest('hex');
    for (const event of [
      webhooks.constructEvent(text, signed, secret),
      await edge.webhooks.constructEventAsync(text, signed, secret),
    ]) {
      if (event.event_type !== 'identification.scored') throw new Error('wrong event type');
      expect(event.data.detection_flags.ai_browser).toBe(true);
      expect(event.data.detection_flags.network_check_incomplete).toBe(true);
      expect(Object.keys(event.data.detection_flags)).toHaveLength(20);
      expect(event.data.identification_id).toBe(fixture.data.identification_id);
    }
  });

  it.each(['identification_id', 'request_id'])(
    'reads the %s History ID without losing it',
    async (key) => {
      const id = fixture.data.identification_id as string;
      const client = new ShieldLabs({
        apiKey: TEST_API_KEY,
        fetch: async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  [key]: id,
                  device_id: fixture.data.device_id,
                  score: 60,
                  created_at: '2026-10-28 00:00:00.000',
                },
              ],
              total: 1,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      });
      const row = await client.identifications.get(id, {
        domainId: '11111111-1111-4111-8111-111111111111',
        wait: false,
      });
      expect(row?.identification_id).toBe(id);
      expect(row?.risk_score).toBe(60);
    },
  );

  it.each(['1234567890abcdef1234567890abcdef12345678', 'logical-event'])(
    'preserves opaque event ID %s without imposing a UUID format',
    async (eventId) => {
      const payload = JSON.stringify({ ...fixture, event_id: eventId });
      const signed = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
      expect(webhooks.constructEvent(payload, signed, secret).raw.event_id).toBe(eventId);
      expect((await edge.webhooks.constructEventAsync(payload, signed, secret)).raw.event_id).toBe(
        eventId,
      );
    },
  );

  it('keeps both entry points on the candidate version', () => {
    expect(edge.VERSION).toBe(VERSION);
    expect(VERSION).toBe('1.3.2');
  });
});

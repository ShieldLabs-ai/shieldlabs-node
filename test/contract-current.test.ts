import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { webhooks } from '../src/index.js';
it('preserves current signed Core identity, fp21, HRE and zero-weight events', () => {
  const raw = readFileSync(new URL('./contracts/current.json', import.meta.url));
  const header = 'sha256=' + createHmac('sha256', 'secret').update(raw).digest('hex');
  const event = webhooks.constructEvent(raw, header, 'secret');
  expect(event.event_id).toBeTruthy();
  expect(event.site_id).toBe(7);
  if (event.event_type !== 'identification.scored') throw new Error('unexpected type');
  expect(event.data.risk_events).toBeUndefined();
  expect(event.data.fingerprint).toBeUndefined();
  expect(event.data.detection_flags.os_mismatch2).toBeUndefined();
  expect(event.data.hre?.account_sharing.cluster_id).toBeNull();
  expect(event.data.hre?.account_takeover).toMatchObject({
    status: 'not_evaluated',
    reason: 'no_history',
    level: null,
  });
  expect(event.data.scoring_version).toBe('core:fixture');
  expect(webhooks.verifySignature(Buffer.concat([raw, Buffer.from(' ')]), header, 'secret')).toBe(
    false,
  );
});

it('preserves accepted bot ownership and nullable HRE cluster IDs', () => {
  const raw = readFileSync(new URL('./contracts/ai-bot.json', import.meta.url));
  const header = 'sha256=' + createHmac('sha256', 'secret').update(raw).digest('hex');
  const event = webhooks.constructEvent(raw, header, 'secret');
  if (event.event_type !== 'identification.scored') throw new Error('wrong type');
  expect(event.data.ai_bot_owner).toBe('OpenAI');
  expect(event.data.detection_flags.ai_bot).toBe(true);
  expect(event.data.hre?.account_takeover.cluster_id).toBeNull();
});

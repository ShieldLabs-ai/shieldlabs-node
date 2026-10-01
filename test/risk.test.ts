import { describe, expect, it, vi } from 'vitest';
import {
  NIL_UUID,
  RISK_BANDS,
  SIGNALS,
  ValidationError,
  evaluateIdentification,
  isRateLimited,
  riskBand,
} from '../src/index.js';
import { fromHistoryRow } from '../src/normalize.js';
import type { Identification } from '../src/types.js';
import { loadJson } from './helpers.js';

const bands = loadJson<{ cases: { score: number; band: string }[] }>('risk-band-cases.json');
const page = loadJson<{ data: Record<string, unknown>[] }>('history-page.json');

// Fixture rows: 0 dangerous (80, paid click), 1 trusted anonymous (10), 2 VPN (45), 3 marker (999), 4 search bot (0).
const NOW = Date.parse('2026-09-30T12:41:00.000Z');

function identification(index: number, changes: Partial<Identification> = {}): Identification {
  const base = fromHistoryRow(page.data[index] as Record<string, unknown>);
  return { ...base, observed_at: '2026-09-30T12:40:01.007Z', ...changes };
}

describe('riskBand', () => {
  it.each(bands.cases)('score $score is $band', ({ score, band }) => {
    expect(riskBand(score)).toBe(band);
  });

  it('treats every score above 100 as the rate-limit marker', () => {
    expect(riskBand(101)).toBe('rate_limited');
    expect(riskBand(100)).toBe('dangerous');
  });

  it('refuses values that are not numbers instead of calling them trusted', () => {
    expect(() => riskBand(Number.NaN)).toThrow(ValidationError);
    expect(() => riskBand('80' as unknown as number)).toThrow(ValidationError);
    expect(() => riskBand(undefined as unknown as number)).toThrow(ValidationError);
  });
});

describe('isRateLimited', () => {
  it('is true only above 100', () => {
    expect(isRateLimited(999)).toBe(true);
    expect(isRateLimited(101)).toBe(true);
    expect(isRateLimited(100)).toBe(false);
    expect(isRateLimited(0)).toBe(false);
    expect(isRateLimited(Number.NaN)).toBe(false);
    expect(isRateLimited('999' as unknown as number)).toBe(false);
  });
});

describe('constants', () => {
  it('describes the three bands', () => {
    expect(RISK_BANDS).toEqual({
      trusted: { min: 0, max: 29 },
      suspicious: { min: 30, max: 59 },
      dangerous: { min: 60, max: 100 },
    });
    expect(Object.isFrozen(RISK_BANDS)).toBe(true);
    expect(Object.isFrozen(RISK_BANDS.trusted)).toBe(true);
    for (const [band, range] of Object.entries(RISK_BANDS)) {
      expect(riskBand(range.min)).toBe(band);
      expect(riskBand(range.max)).toBe(band);
    }
  });

  it('lists known signal slugs as unique, frozen constants', () => {
    const values = Object.values(SIGNALS);
    expect(new Set(values).size).toBe(values.length);
    expect(Object.isFrozen(SIGNALS)).toBe(true);
    expect(SIGNALS.VPN).toBe('vpn');
    expect(SIGNALS.ANTIDETECT_BROWSER).toBe('antidetect_browser');
    expect(SIGNALS.RATE_LIMITED).toBe('rate_limited');
    expect(SIGNALS.STUN_LATE_CORRECTION).toBe('stun_late_correction');
  });

  it('includes every slug that appears in the fixtures', () => {
    const scored = loadJson<{ data: { signals: { name: string }[] } }>(
      'webhook-identification-scored.json',
    );
    const known = new Set<string>(Object.values(SIGNALS));
    for (const signal of scored.data.signals) expect(known.has(signal.name)).toBe(true);
  });

  it('exposes the nil UUID', () => {
    expect(NIL_UUID).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('evaluateIdentification', () => {
  it('refuses a missing identification', () => {
    expect(evaluateIdentification(null)).toEqual({ ok: false, reason: 'missing', band: null });
    expect(evaluateIdentification(undefined)).toEqual({ ok: false, reason: 'missing', band: null });
  });

  it('accepts a fresh trusted identification', () => {
    const result = evaluateIdentification(identification(1), { now: NOW });
    expect(result).toEqual({ ok: true, reason: null, band: 'trusted' });
    expect('flag' in result).toBe(false);
  });

  it('asks isReplay with the request ID and refuses replays first', () => {
    const isReplay = vi.fn(() => true);
    const stale = identification(0, { observed_at: '2020-01-01T00:00:00.000Z' });
    expect(evaluateIdentification(stale, { now: NOW, isReplay })).toEqual({
      ok: false,
      reason: 'replayed',
      band: 'dangerous',
    });
    expect(isReplay).toHaveBeenCalledWith('02f1d973-84db-4156-a7f7-e799e6bf389b');
  });

  it('treats any truthy isReplay result as a replay', () => {
    const isReplay = (() => 1) as unknown as (id: string) => boolean;
    expect(evaluateIdentification(identification(1), { now: NOW, isReplay }).reason).toBe(
      'replayed',
    );
    expect(evaluateIdentification(identification(1), { now: NOW, isReplay: () => false }).ok).toBe(
      true,
    );
  });

  it('rejects an asynchronous isReplay', () => {
    const isReplay = (() => Promise.resolve(false)) as unknown as (id: string) => boolean;
    expect(() => evaluateIdentification(identification(1), { now: NOW, isReplay })).toThrow(
      ValidationError,
    );
  });

  it('refuses identifications older than maxAge', () => {
    const observed = Date.parse('2026-09-30T12:40:01.007Z');
    expect(evaluateIdentification(identification(1), { now: observed + 300_000 }).ok).toBe(true);
    expect(evaluateIdentification(identification(1), { now: observed + 300_001 })).toEqual({
      ok: false,
      reason: 'stale',
      band: 'trusted',
    });
    expect(
      evaluateIdentification(identification(1), { now: observed + 60_001, maxAge: 60_000 }).reason,
    ).toBe('stale');
    expect(evaluateIdentification(identification(1), { now: new Date(observed + 1_000) }).ok).toBe(
      true,
    );
  });

  it('skips the freshness check for maxAge Infinity', () => {
    const observed = Date.parse('2026-09-30T12:40:01.007Z');
    const options = { now: observed + 86_400_000, maxAge: Number.POSITIVE_INFINITY };
    expect(evaluateIdentification(identification(1), options).ok).toBe(true);
    expect(evaluateIdentification(identification(1, { observed_at: null }), options).ok).toBe(true);
    expect(evaluateIdentification(identification(1), { ...options, maxAge: 0 }).reason).toBe(
      'stale',
    );
  });

  it('treats an unknown observation time as stale', () => {
    expect(
      evaluateIdentification(identification(1, { observed_at: null }), { now: NOW }).reason,
    ).toBe('stale');
    expect(
      evaluateIdentification(identification(1, { observed_at: 'garbage' }), { now: NOW }).reason,
    ).toBe('stale');
  });

  it('uses the current time by default', () => {
    const fresh = identification(1, { observed_at: new Date().toISOString() });
    expect(evaluateIdentification(fresh).ok).toBe(true);
  });

  it('refuses the rate-limit marker before any device or band check', () => {
    expect(evaluateIdentification(identification(3), { now: NOW })).toEqual({
      ok: false,
      reason: 'rate_limited',
      band: 'rate_limited',
    });
  });

  it('refuses identifications without device signals', () => {
    expect(
      evaluateIdentification(identification(1, { device_id: NIL_UUID }), { now: NOW }).reason,
    ).toBe('no_device_signals');
    expect(evaluateIdentification(identification(1, { device_id: '' }), { now: NOW }).reason).toBe(
      'no_device_signals',
    );
  });

  it('refuses the default blocking flags and names the flag', () => {
    const automation = identification(1);
    automation.detection_flags = { ...automation.detection_flags, browser_automation: true };
    expect(evaluateIdentification(automation, { now: NOW })).toEqual({
      ok: false,
      reason: 'blocked_flag',
      band: 'trusted',
      flag: 'browser_automation',
    });

    const noJs = identification(1);
    noJs.detection_flags = { ...noJs.detection_flags, javascript_disabled: true };
    expect(evaluateIdentification(noJs, { now: NOW }).flag).toBe('javascript_disabled');
  });

  it('checks flags before bands and supports custom flags', () => {
    const dangerous = identification(0);
    expect(evaluateIdentification(dangerous, { now: NOW, blockFlags: ['proxy'] })).toEqual({
      ok: false,
      reason: 'blocked_flag',
      band: 'dangerous',
      flag: 'proxy',
    });
  });

  it('refuses the dangerous band by default', () => {
    expect(evaluateIdentification(identification(0), { now: NOW })).toEqual({
      ok: false,
      reason: 'blocked_band',
      band: 'dangerous',
    });
  });

  it('supports custom bands and empty lists', () => {
    const suspicious = identification(2);
    expect(evaluateIdentification(suspicious, { now: NOW }).ok).toBe(true);
    expect(
      evaluateIdentification(suspicious, { now: NOW, blockBands: ['suspicious', 'dangerous'] })
        .reason,
    ).toBe('blocked_band');
    const dangerous = identification(0);
    expect(evaluateIdentification(dangerous, { now: NOW, blockBands: [], blockFlags: [] }).ok).toBe(
      true,
    );
  });

  it('validates its options', () => {
    const value = identification(1);
    expect(() => evaluateIdentification(value, { maxAge: -1 })).toThrow(ValidationError);
    expect(() => evaluateIdentification(value, { maxAge: Number.NaN })).toThrow(ValidationError);
    expect(() => evaluateIdentification(value, { maxAge: Number.NEGATIVE_INFINITY })).toThrow(
      ValidationError,
    );
    expect(() => evaluateIdentification(value, { now: new Date('invalid') })).toThrow(
      ValidationError,
    );
    expect(() =>
      evaluateIdentification(value, { blockBands: ['rate_limited' as unknown as 'dangerous'] }),
    ).toThrow(ValidationError);
    expect(() =>
      evaluateIdentification(value, { blockFlags: ['browser_automations' as unknown as 'vpn'] }),
    ).toThrow(ValidationError);
    expect(() => evaluateIdentification(null, { maxAge: -5 })).toThrow(ValidationError);
  });

  it('throws when the identification carries no numeric score', () => {
    expect(() =>
      evaluateIdentification(identification(1, { risk_score: Number.NaN }), { now: NOW }),
    ).toThrow(ValidationError);
  });
});

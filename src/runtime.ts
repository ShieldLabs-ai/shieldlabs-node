import { VERSION } from './version.js';

interface RuntimeGlobals {
  Bun?: { version?: unknown };
  Deno?: { version?: { deno?: unknown } };
  EdgeRuntime?: unknown;
  navigator?: { userAgent?: unknown };
  process?: { versions?: { node?: unknown } };
}

export function detectRuntime(): string | null {
  const g = globalThis as unknown as RuntimeGlobals;
  if (typeof g.Bun?.version === 'string') return `bun/${g.Bun.version}`;
  if (typeof g.Deno?.version?.deno === 'string') return `deno/${g.Deno.version.deno}`;
  if (typeof g.EdgeRuntime === 'string') return 'edge-runtime';
  if (g.navigator?.userAgent === 'Cloudflare-Workers') return 'workerd';
  if (typeof g.process?.versions?.node === 'string') return `node/${g.process.versions.node}`;
  return null;
}

let cachedUserAgent: string | undefined;

/** "shieldlabs-node/<version>" followed by the runtime, for example "node/20.11.1". */
export function userAgent(): string {
  if (cachedUserAgent === undefined) {
    const runtime = detectRuntime();
    cachedUserAgent = runtime
      ? `shieldlabs-node/${VERSION} ${runtime}`
      : `shieldlabs-node/${VERSION}`;
  }
  return cachedUserAgent;
}

/** The reason an aborted signal carries, or a generic AbortError. */
export function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** Longest delay of one timer: runtimes fire a timer with a longer delay almost at once. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Waits `ms` milliseconds; rejects with the abort reason as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    // A wait longer than one timer allows runs as a chain of timers.
    const wait = (left: number): void => {
      timer = setTimeout(
        () => {
          if (left > MAX_TIMER_DELAY_MS) {
            wait(left - MAX_TIMER_DELAY_MS);
            return;
          }
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        Math.min(left, MAX_TIMER_DELAY_MS),
      );
    };
    wait(ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const warned = new Set<string>();
const MAX_WARNINGS = 32;

/** Prints a warning once per process for each key. Never include secrets in `message`. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key) || warned.size >= MAX_WARNINGS) return;
  warned.add(key);
  console.warn(`[shieldlabs] ${message}`);
}

/**
 * Warns once when a client is created in a web page (a global window with a document), where its
 * key is visible to every visitor. Servers, workers and edge runtimes stay silent.
 */
export function warnIfBrowserPage(client: string, key: string): void {
  const g = globalThis as { window?: unknown; document?: unknown };
  if (g.window !== undefined && g.document !== undefined) {
    warnOnce(
      `browser-page:${client}`,
      `${client} was created in a web page, where its ${key} is visible to every visitor. Use @shieldlabs-ai/node on your server only; in the page, use the browser SDK (@shieldlabs-ai/js).`,
    );
  }
}

/** Test hook: forget which warnings were printed. */
export function resetWarnings(): void {
  warned.clear();
}

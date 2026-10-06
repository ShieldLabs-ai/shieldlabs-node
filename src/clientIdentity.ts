import type { ClientIdentity } from './types.js';

/** Preserve stored attribution; missing/malformed optional data stays absent. */
export function clientIdentityField(value: unknown): { client_identity?: ClientIdentity } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const data = value as Record<string, unknown>;
  for (const key of ['schema_version', 'availability', 'registry_revision', 'observed_at']) {
    if (typeof data[key] !== 'string') return {};
  }
  if (typeof data.classification_revision !== 'number' || data.classification_revision < 1)
    return {};
  for (const key of ['claims', 'verified', 'assessments', 'evidence']) {
    if (!Array.isArray(data[key])) return {};
  }
  return { client_identity: data as unknown as ClientIdentity };
}

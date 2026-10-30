import { validateLookup } from './validation.js';
import { ApiError, ValidationError } from './errors.js';
import type { Transport } from './http.js';

export type HistoryResource = 'identifications' | 'user' | 'visitor' | 'device' | 'ip';
export type HistoryListResource = 'identifications' | 'user';
export type EntityRisk =
  | { state: 'ok'; band: 'trusted' | 'suspicious' | 'dangerous'; score?: number; as_of: string }
  | { state: 'unavailable'; band: null; as_of: null; score?: never };
export interface HistoryEntity {
  type: 'identification' | 'user' | 'visitor' | 'device' | 'ip';
  id: string;
  domain_id: string;
  domain: string;
  risk: EntityRisk;
  signals: { state: 'ok' | 'unavailable'; items: string[] };
  created_at?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  identifications?: number | null;
  visitor_id?: string | null;
  user_hid?: string | null;
  device_id?: string | null;
  device_id_source?: string | null;
  public_ip?: string | null;
  country?: string | null;
  browser?: string | null;
  os?: string | null;
  device_type?: string | null;
  connection_type?: string | null;
  session_id?: string | null;
  cookie_id?: string | null;
  local_ip?: string | null;
  local_country?: string | null;
  device_identity?: {
    hardware_id?: string | null;
    legacy_device_id?: string | null;
    hardware_ids?: string[];
    legacy_device_ids?: string[];
    record_ids?: string[];
    state?: string;
  } | null;
  traffic?: Record<string, string | null> | null;
  identity_risk?: Record<string, EntityRisk | null> | null;
  high_risk_events?: {
    state: string;
    as_of: string | null;
    items: { code: string; confidence: string }[];
  } | null;
  related_counts?: Record<string, number> | null;
  attributes?: Record<string, unknown> | null;
  band_split?: { trusted: number; suspicious: number; dangerous: number } | null;
}
export interface EntityPage {
  data: HistoryEntity[];
  next_page_token: string | null;
}
export interface EntityWindow {
  from?: string;
  to?: string;
  signal?: AbortSignal;
}
export interface EntityListOptions extends EntityWindow {
  limit?: number;
  page_token?: string;
  snapshot?: string;
  risk_bands?: string[];
  hre_min_accounts?: number;
  hre_min_devices?: number;
  /** Exact user id. Sent as one query parameter on the user list. */
  ids?: string;
  risk_signals?: string[];
  source?: string[];
  campaign?: string[];
  is_vpn?: boolean;
  is_tor?: boolean;
  is_proxy?: boolean;
  is_privacy_relay?: boolean;
  network_check_incomplete?: boolean;
  check_incomplete?: boolean;
  is_antidetect?: boolean;
  is_os_mismatch?: boolean;
  is_os_not_detected?: boolean;
  is_timezone_mismatch?: boolean;
  is_js_disabled?: boolean;
  is_browser_automation?: boolean;
  is_incognito?: boolean;
  is_search_bot?: boolean;
  ip_mismatch?: boolean;
  latency_test?: boolean;
  device_spoofing?: boolean;
  banned_ip?: boolean;
  ai_bot?: boolean;
  ai_browser?: boolean;
}
export interface EntityReadOptions extends EntityListOptions {
  device_id_source?: 'legacy' | 'fp21_record';
}
export interface DomainRecord {
  id: string;
  domain: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resources: readonly string[] = ['identifications', 'user', 'visitor', 'device', 'ip'];
function base(domain: string, resource: HistoryResource): string {
  if (!uuid.test(domain)) throw new ValidationError('domain must be the public domain UUID.');
  if (!resources.includes(resource)) throw new ValidationError('Unknown History resource.');
  return `/api/v1/domains/${domain.toLowerCase()}/history/${resource}`;
}
const FLAG_NAMES = [
  'is_vpn',
  'is_tor',
  'is_proxy',
  'is_privacy_relay',
  'network_check_incomplete',
  'check_incomplete',
  'is_antidetect',
  'is_os_mismatch',
  'is_os_not_detected',
  'is_timezone_mismatch',
  'is_js_disabled',
  'is_browser_automation',
  'is_incognito',
  'is_search_bot',
  'ip_mismatch',
  'latency_test',
  'device_spoofing',
  'banned_ip',
  'ai_bot',
  'ai_browser',
] as const;
const LIST_KEYS = [
  'from',
  'to',
  'signal',
  'limit',
  'page_token',
  'snapshot',
  'risk_bands',
  'hre_min_accounts',
  'hre_min_devices',
  'ids',
  'risk_signals',
  'source',
  'campaign',
  ...FLAG_NAMES,
] as const;
const READ_KEYS = [...LIST_KEYS, 'device_id_source'] as const;

function query(options: EntityReadOptions): Record<string, string | readonly string[]> {
  if ((options.from === undefined) !== (options.to === undefined))
    throw new ValidationError('Send both from and to, or neither.');
  const out: Record<string, string | readonly string[]> = {};
  if (options.from !== undefined && options.to !== undefined) {
    for (const value of [options.from, options.to])
      if (
        !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new ValidationError('History dates must be RFC3339.');
    if (Date.parse(options.from) >= Date.parse(options.to))
      throw new ValidationError('from must be before to.');
    out.from = options.from;
    out.to = options.to;
  }
  if (options.snapshot !== undefined) out.snapshot = options.snapshot;
  for (const key of ['risk_bands', 'risk_signals', 'source', 'campaign'] as const) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === ''))
      throw new ValidationError(`${key} must be a list of strings.`);
    out[key] = value;
  }
  if (options.ids !== undefined) {
    // Preserve the single-element form used by already installed 1.x clients.
    const legacy: unknown = options.ids;
    const value: unknown = Array.isArray(legacy) && legacy.length === 1 ? legacy[0] : legacy;
    if (typeof value !== 'string' || value.length === 0 || value.length > 512)
      throw new ValidationError('ids must be one non-empty user id string.');
    out.ids = value;
  }
  const sourceCount = options.source?.length ?? 0;
  const campaignCount = options.campaign?.length ?? 0;
  if (sourceCount + campaignCount > 8)
    throw new ValidationError('source and campaign together accept at most 8 values.');
  if (options.hre_min_accounts !== undefined) {
    if (
      !Number.isInteger(options.hre_min_accounts) ||
      options.hre_min_accounts < 3 ||
      options.hre_min_accounts > 99
    )
      throw new ValidationError('hre_min_accounts must be from 3 through 99.');
    out.hre_min_accounts = String(options.hre_min_accounts);
  }
  if (options.hre_min_devices !== undefined) {
    if (
      !Number.isInteger(options.hre_min_devices) ||
      options.hre_min_devices < 4 ||
      options.hre_min_devices > 99
    )
      throw new ValidationError('hre_min_devices must be from 4 through 99.');
    out.hre_min_devices = String(options.hre_min_devices);
  }
  for (const name of FLAG_NAMES) {
    const value = options[name];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new ValidationError(`${name} must be true or false.`);
    out[name] = value ? 'true' : 'false';
  }
  return out;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(): never {
  throw new ApiError('History API returned an invalid entity response.', { status: 200 });
}
/** Validates states without replacing missing data with a score or a negative flag. */
export function parseHistoryEntity(value: unknown): HistoryEntity {
  if (
    !isObject(value) ||
    !['identification', 'user', 'visitor', 'device', 'ip'].includes(String(value.type)) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.domain_id !== 'string' ||
    !uuid.test(value.domain_id) ||
    typeof value.domain !== 'string' ||
    !isObject(value.risk) ||
    !isObject(value.signals)
  )
    return invalid();
  const risk = value.risk;
  if (risk.state === 'ok') {
    if (
      !['trusted', 'suspicious', 'dangerous'].includes(String(risk.band)) ||
      typeof risk.as_of !== 'string' ||
      !Number.isFinite(Date.parse(risk.as_of))
    )
      return invalid();
    if (
      risk.score !== undefined &&
      (typeof risk.score !== 'number' ||
        !Number.isInteger(risk.score) ||
        risk.score < 0 ||
        risk.score > 100)
    )
      return invalid();
    if (value.type === 'identification' && risk.score === undefined) return invalid();
  } else if (
    risk.state !== 'unavailable' ||
    risk.band !== null ||
    risk.as_of !== null ||
    risk.score !== undefined
  )
    return invalid();
  if (
    !['ok', 'unavailable'].includes(String(value.signals.state)) ||
    !Array.isArray(value.signals.items) ||
    !value.signals.items.every((v) => typeof v === 'string')
  )
    return invalid();
  if (
    value.identifications !== undefined &&
    value.identifications !== null &&
    (typeof value.identifications !== 'number' ||
      !Number.isSafeInteger(value.identifications) ||
      value.identifications < 0)
  )
    return invalid();
  return value as unknown as HistoryEntity;
}
export function parseEntityPage(value: unknown): EntityPage {
  if (
    !isObject(value) ||
    !Array.isArray(value.data) ||
    (value.next_page_token !== undefined &&
      value.next_page_token !== null &&
      typeof value.next_page_token !== 'string')
  )
    return invalid();
  return {
    data: value.data.map(parseHistoryEntity),
    next_page_token: typeof value.next_page_token === 'string' ? value.next_page_token : null,
  };
}
/** Normalize only the identifiers the entity API accepts, preserving exact User HID text. */
export function normalizeHistoryEntityId(resource: HistoryResource, id: string): string {
  if (
    !id ||
    id.length > 512 ||
    /[/\\]/.test(id) ||
    [...id].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    id === '.' ||
    id === '..'
  )
    throw new ValidationError('Invalid entity id.');
  if (resource === 'ip') {
    if (id.includes(':')) {
      let host = '';
      try {
        host = new URL(`http://[${id}]/`).hostname;
      } catch {
        throw new ValidationError('Invalid IP entity id.');
      }
      const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/i.exec(host);
      if (!mapped) throw new ValidationError('Pure IPv6 is not supported by History.');
      const high = Number.parseInt(mapped[1]!, 16),
        low = Number.parseInt(mapped[2]!, 16);
      return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return validateLookup('ip', id).value;
  }
  if (['identifications', 'visitor', 'device'].includes(resource)) {
    if (!uuid.test(id)) throw new ValidationError('This entity id must be a UUID.');
    return id.toLowerCase();
  }
  return id;
}
function knownOptions(options: object, allowed: readonly string[]): void {
  if (Object.keys(options).some((key) => !allowed.includes(key)))
    throw new ValidationError(
      'Unsupported History option. Filters are flat query parameters. Nested filter, chips, offset and include_total are not accepted.',
    );
}
function readQuery(options: EntityReadOptions): Record<string, string | readonly string[]> {
  const params = query(options);
  if (options.device_id_source !== undefined) {
    if (options.device_id_source !== 'legacy' && options.device_id_source !== 'fp21_record')
      throw new ValidationError('device_id_source must be legacy or fp21_record.');
    params.device_id_source = options.device_id_source;
  }
  return params;
}
/** Domain-scoped current History API. Cards and lists preserve their availability states. */
export class EntityHistoryResource {
  constructor(private readonly transport: Transport) {}
  async domains(): Promise<DomainRecord[]> {
    const response = await this.transport.getJson('/api/v1/domains');
    if (!isObject(response.body) || !Array.isArray(response.body.domains)) return invalid();
    return response.body.domains.map((row) => {
      if (
        !isObject(row) ||
        typeof row.id !== 'string' ||
        !uuid.test(row.id) ||
        typeof row.domain !== 'string'
      )
        return invalid();
      return { id: row.id.toLowerCase(), domain: row.domain };
    });
  }
  async list(
    domain: string,
    resource: HistoryListResource,
    options: EntityListOptions = {},
  ): Promise<EntityPage> {
    knownOptions(options, LIST_KEYS);
    const path = base(domain, resource);
    if (resource !== 'identifications' && resource !== 'user')
      throw new ValidationError('Only identifications and user have lists.');
    if (resource !== 'user' && options.ids !== undefined)
      throw new ValidationError('ids is only accepted on the user list.');
    const params = query(options);
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ValidationError('limit must be from 1 through 100.');
    params.limit = String(limit);
    if (options.page_token !== undefined) {
      if (!options.page_token || options.page_token.length > 4096)
        throw new ValidationError('Invalid page_token.');
      params.page_token = options.page_token;
    }
    const response = await this.transport.getJson(path, { query: params, signal: options.signal });
    const page = parseEntityPage(response.body);
    if (
      page.data.length > limit ||
      page.data.some(
        (row) =>
          row.domain_id.toLowerCase() !== domain.toLowerCase() ||
          row.type !== (resource === 'identifications' ? 'identification' : resource),
      )
    )
      return invalid();
    return page;
  }
  async get(
    domain: string,
    resource: HistoryResource,
    id: string,
    options: EntityReadOptions = {},
  ): Promise<HistoryEntity> {
    const path = base(domain, resource);
    knownOptions(options, READ_KEYS);
    const normalized = normalizeHistoryEntityId(resource, id);
    const params = readQuery(options);
    const response = await this.transport.getJson(`${path}/${encodeURIComponent(normalized)}`, {
      query: Object.keys(params).length ? params : undefined,
      signal: options.signal,
    });
    if (!isObject(response.body)) return invalid();
    const entity = parseHistoryEntity(response.body.data);
    if (
      entity.id !== normalized ||
      entity.domain_id.toLowerCase() !== domain.toLowerCase() ||
      entity.type !== (resource === 'identifications' ? 'identification' : resource)
    )
      return invalid();
    return entity;
  }
}

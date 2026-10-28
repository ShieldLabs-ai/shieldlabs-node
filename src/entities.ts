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
  identifications?: number;
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
  traffic?: Record<string, string | null>;
  identity_risk?: Record<string, EntityRisk | null>;
  high_risk_events?: {
    state: string;
    as_of: string | null;
    items: { code: string; confidence: string }[];
  };
  related_counts?: Record<string, number>;
  attributes?: Record<string, unknown>;
  band_split?: { trusted: number; suspicious: number; dangerous: number };
}
export interface EntityPage {
  data: HistoryEntity[];
  next_page_token: string | null;
  total?: number;
}
export interface EntityWindow {
  from?: string;
  to?: string;
  signal?: AbortSignal;
}
export interface EntityListOptions extends EntityWindow {
  limit?: number;
  page_token?: string;
  include_total?: boolean;
  sort?: string;
  filter?: {
    identification?: {
      ids?: Record<string, string>;
      device_id_source?: string;
      risk_bands?: string[];
      chips?: { dimension: string; value: string }[];
      hre_min_accounts?: number;
      hre_min_devices?: number;
    };
    entity?: { ids?: string[]; risk_bands?: string[] };
  };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resources: readonly string[] = ['identifications', 'user', 'visitor', 'device', 'ip'];
function base(domain: string, resource: HistoryResource): string {
  if (!uuid.test(domain)) throw new ValidationError('domain must be the public domain UUID.');
  if (!resources.includes(resource)) throw new ValidationError('Unknown History resource.');
  return `/api/v1/domains/${domain.toLowerCase()}/history/${resource}`;
}
function query(options: EntityWindow): Record<string, string> {
  if ((options.from === undefined) !== (options.to === undefined))
    throw new ValidationError('Send both from and to, or neither.');
  const out: Record<string, string> = {};
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
    !(value.next_page_token === null || typeof value.next_page_token === 'string')
  )
    return invalid();
  if (
    value.total !== undefined &&
    (typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0)
  )
    return invalid();
  return {
    data: value.data.map(parseHistoryEntity),
    next_page_token: value.next_page_token,
    ...(value.total === undefined ? {} : { total: value.total }),
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
      'Unsupported entity History option. Use page_token, not offset or legacy row filters.',
    );
}
/** Domain-scoped current History API. Cards and lists preserve their availability states. */
export class EntityHistoryResource {
  constructor(private readonly transport: Transport) {}
  async list(
    domain: string,
    resource: HistoryListResource,
    options: EntityListOptions = {},
  ): Promise<EntityPage> {
    knownOptions(options, [
      'from',
      'to',
      'signal',
      'limit',
      'page_token',
      'include_total',
      'sort',
      'filter',
    ]);
    const path = base(domain, resource);
    if (resource !== 'identifications' && resource !== 'user')
      throw new ValidationError('Only identifications and user have lists.');
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
    if (options.include_total !== undefined) params.include_total = String(options.include_total);
    if (options.sort !== undefined) params.sort = options.sort;
    if (options.filter !== undefined) params.filter = JSON.stringify(options.filter);
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
    options: EntityWindow = {},
  ): Promise<HistoryEntity> {
    const path = base(domain, resource);
    knownOptions(options, ['from', 'to', 'signal']);
    const normalized = normalizeHistoryEntityId(resource, id);
    const params = query(options);
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

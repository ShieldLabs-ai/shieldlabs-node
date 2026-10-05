/**
 * Generated from resources/shieldlabs-api.yaml. Do not edit by hand.
 * Refresh with: ./sync.sh && npm run generate
 */
export interface paths {
    "/api/v1/history/{search_type}/{value}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search identifications
         * @description Returns the identifications of your domain that match one identifier, newest first, together
         *     with the total number of matches. The Private API Key selects the domain; identifications from
         *     its subdomains are included (`domain` holds the host, `site_domain` the registered domain).
         *
         *     **Read one verdict.** After a protected action, search by `request_id` with `limit=1`. The row
         *     appears about 1-3 seconds after the browser call and can be refined for up to about 10 seconds
         *     as follow-up network checks finish, so start the identification when the user begins the
         *     action (for example when the signup form opens), not when the form is submitted. An empty
         *     `data` array means "not scored yet", never "clean". Poll with backoff (first try at once, then
         *     wait 250 ms, 500 ms, 1 s, then steps of about 1.5 s) and treat a `429` inside that loop as
         *     "wait longer". The official server SDKs do this for you.
         *
         *     **Account-level checks.** Search by `device_id`, `user_hid`, `visitor_id` or `ip` to see how
         *     many accounts share a device, how many devices one account uses, or what else came from one
         *     IP address. When you count accounts, skip rows whose `user_hid` is empty or one of the values
         *     that do not identify a user: `anonymous`, `fail`, `-1` and `unknown`.
         *
         *     **Validate before sending.** The server does not validate the path: an unknown `search_type`
         *     returns the latest identifications of the whole domain unfiltered, a malformed UUID or IPv4
         *     value returns `500`, and a `limit` outside 1-100 silently becomes 20.
         *
         *     **Paging.** Page with `offset` while it is below `total`. Rows are ordered by `created_at`
         *     only, so paging while new identifications arrive can repeat or skip rows: deduplicate on
         *     `request_id`.
         *
         *     **Latest state.** A row can be refined after the webhook was sent, for example when late
         *     network data re-scores it; its `ver` then increases. The History API always returns the latest
         *     version, which makes it the guaranteed read path.
         *
         *     Reads are free: they do not use your included identifications.
         */
        get: operations["searchHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the domain profile
         * @description Returns the registered domain, the remaining included identifications of the account and the
         *     masked keys.
         *
         *     **Credentials.** Send the Secret Key as a Bearer token and the registered domain in
         *     `X-Shield-Domain`. The domain is matched exactly: send it lowercase, without scheme, path,
         *     trailing slash or a leading `www.`.
         *
         *     **Rate limit.** 15 requests per minute per client IP. The request that goes over the limit
         *     starts a 10-minute block during which every request to the Management API gets `429`. Call
         *     this endpoint sparingly, cache the profile, and never retry a `429`.
         *
         *     `Weight` can be negative when the account is over its included volume. The call is free.
         */
        get: operations["getDomainProfile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/history/{type}/{value}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search history by identifier (deprecated)
         * @deprecated
         * @description **Deprecated.** This endpoint stops working after Sat, 01 Jan 2027 00:00:00 GMT. Use
         *     `searchHistory` on the History API instead: `https://account.shieldlabs.ai/api/v1/history`.
         *     Every answer of this route except `429` and `503` carries `Deprecation: true`, a `Sunset`
         *     header and a `Link` header with `rel="successor-version"` pointing there. The plain-text `404`
         *     for a path that matches no route and the edge proxy errors do not carry them.
         *
         *     Differences from the History API: the answer is a bare array of PascalCase objects; only rows
         *     whose request host equals `X-Shield-Domain` are returned (no subdomain traffic); `limit`
         *     defaults to 100 and there is no `offset`. It uses the Management API credentials and rate limit
         *     (15 requests per minute per client IP, then a 10-minute block). The call is free.
         */
        get: operations["searchHistoryDeprecated"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check service health
         * @description Liveness check. Returns `{"status":"ok"}` while the service answers. Available on both API
         *     hosts: `https://account.shieldlabs.ai/health` for the History API and
         *     `https://api.shieldlabs.ai/health` for the Management API. No authentication, not rate
         *     limited, not billed.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface webhooks {
    "identification.scored": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Identification scored
         * @description Sent after final snapshot scoring and mandatory fp21 + three HRE handlers. Risk score is the identification score only. AI bots and AI browser are not implemented and not emitted.
         *
         *     Verify HMAC-SHA256 over exact raw bytes with the endpoint secret. Body event_id is signed; X-Shield-Event-Id is its convenience mirror. Persist and deduplicate by event_id before returning 2xx within the 1-second send timeout. Legacy bodies without event_id can use data.request_id. Retries preserve body and ID. Network/timeouts/429/5xx are retried with backoff up to 8 failed sends or 15 minutes of retry age; exhaustion/permanent 4xx goes to DLQ. Delivery is at-least-once attempts within that window, not guaranteed eternal delivery or exactly-once. Endpoints are independent. Redirects are not followed.
         *
         *     Use History for recovery/latest state; later snapshot corrections do not automatically emit another identification.scored event.
         */
        post: operations["identificationScored"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "webhook.ping": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Endpoint verification
         * @description Sent when you verify an endpoint in the analytics dashboard. It carries no `data`. A 2xx
         *     answer within 5 seconds marks the endpoint as verified; anything else marks the verification
         *     as failed.
         *
         *     The body is signed exactly like `identification.scored`. Its keys are sorted alphabetically
         *     and `created_at` has second precision. Worked example with the test secret
         *     `whsec_00112233445566778899aabbccddeeff`: the body
         *
         *     ```json
         *     {"created_at":"2026-09-30T12:34:56Z","event_type":"webhook.ping","schema_version":"2026-06-01"}
         *     ```
         *
         *     arrives with `X-Shield-Signature: sha256=ea2685733d254f7028fb031c4214583b0650de01e6c8c93131236024edd9fdd8`.
         */
        post: operations["webhookPing"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export interface components {
    schemas: {
        /**
         * Format: uuid
         * @description Identifies one identification. The browser creates it as a UUID v4 and hands it to your page; it is the join key between the browser, the webhook and the History API. The nil UUID appears only on rate-limit marker rows that arrived with a malformed request ID.
         * @example a5b7c9d1-e3f5-4a7b-9c1d-3e5f7a9b1c3d
         */
        RequestId: string;
        /**
         * Format: uuid
         * @description One visit on one origin (UUID v4 created in the browser), shared by the open tabs of that origin. The next visit after the last tab closes gets a new session ID. The nil UUID appears on rate-limit marker rows.
         * @example b6c8d0e2-f4a6-4b8c-8d0e-2f4a6b8c0d2e
         */
        SessionId: string;
        /**
         * Format: uuid
         * @description First-party browser identifier kept by the ShieldLabs agent (UUID v4). A missing or malformed value is stored as the nil UUID.
         * @example c7d9e1f3-a5b7-4c9d-ae1f-3a5b7c9d1e3f
         */
        CookieId: string;
        /**
         * Format: uuid
         * @description Server-side device identifier (UUID v5). It survives cleared cookies and private windows. The nil UUID `00000000-0000-0000-0000-000000000000` means that no usable device signals were collected (for example on rate-limit marker rows): never group identifications by it.
         * @example d8e0f2a4-b6c8-4d0e-bf2a-4b6c8d0e2f4a
         * @example 00000000-0000-0000-0000-000000000000
         */
        DeviceId: string;
        /**
         * Format: uuid
         * @description Server-side visitor identifier (UUID v5). It is sticky to the device: a new cookie on a known device keeps the existing visitor ID, so clearing cookies usually does not change it. The nil UUID appears on identifications without usable device data, such as rate-limit marker rows.
         * @example e9f1a3b5-c7d9-4e1f-8a3b-5c7d9e1f3a5b
         */
        VisitorId: string;
        /**
         * Format: ipv4
         * @description Dotted IPv4 address. `0.0.0.0` when no IPv4 address is known (for example for visitors on IPv6); such identifications cannot be searched by IP.
         * @example 203.0.113.24
         * @example 0.0.0.0
         */
        Ipv4: string;
        /**
         * @description Operating system name, for example `Windows`, `Mac OS X`, `Linux`, `Android`, `IOS (iPhone)`, `IOS (iPad)`, `ChromeOS` or `Unknown`. Open set: display it, do not branch on it.
         * @example Windows
         * @example Mac OS X
         * @example Android
         */
        OperatingSystem: string;
        /**
         * @description Browser name, for example `Chrome`, `Safari`, `Firefox`, `Microsoft Edge`, `Opera`, `Samsung Internet`, `Brave`, `Chrome (iOS)`, `Safari (iOS)` or `Unknown`. Open set: display it, do not branch on it.
         * @example Chrome
         * @example Safari
         */
        Browser: string;
        /**
         * @description Device class from the browser. Known values: `desktop`, `mobile`, `tablet` and `unknown` (the class could not be determined). The set is open: keep values added in later versions and treat them as `unknown`.
         * @example desktop
         */
        DeviceType: string;
        /**
         * @description English country name from IP intelligence, for example `Germany` or `United States` (not an ISO code). Empty string when the country is unknown.
         * @example Netherlands
         * @example United States
         * @example
         */
        Country: string;
        /**
         * @description How the visitor connected. Known values:
         *     - `direct`: a regular connection;
         *     - `mobile`: a mobile carrier network;
         *     - `vpn`: a VPN;
         *     - `proxy`: a proxy, datacenter or hosting network (search-engine crawlers are reported here too);
         *     - `tor`: the Tor network;
         *     - `privacy_relay`: a privacy relay such as iCloud Private Relay;
         *     - `browser_vpn_proxy`: a VPN or proxy built into the browser or one of its extensions;
         *     - `unknown`: not enough data.
         *
         *     The value can say `vpn` while `detection_flags.vpn` is `false` (IP intelligence classified the
         *     network, but the scored VPN check did not fire). Branch on `detection_flags` for decisions.
         *     The set is open: keep values added in later versions and treat them as `unknown`.
         * @example direct
         */
        ConnectionType: string;
        /**
         * @description Risk Score from 0 (no risk found) to 100. Search-engine crawlers always score 0.
         *
         *     Risk bands are computed on your side from the score; no band field exists on the wire:
         *     - trusted: 0-29
         *     - suspicious: 30-59
         *     - dangerous: 60-100
         *
         *     A value above 100 is not a score. `999` is the rate-limit marker: the visitor's IP went over the
         *     ingest rate limit, and the identification carries exactly one signal,
         *     `{"name":"rate_limited","weight":999}`, usually with nil identifiers. Treat every value above
         *     100 as rate limited. One marker is written when the IP goes over the limit; request IDs issued
         *     while it stays blocked get no row and no webhook, so they stay unverified.
         *
         *     The score usually equals the sum of the signal weights capped at 100, but carried-forward
         *     verdicts and corrections make that unreliable: never recompute or validate it yourself.
         * @example 0
         * @example 35
         * @example 80
         * @example 999
         */
        RiskScore: number;
        /** @description One entry behind the score, in the PascalCase shape the server stores. `Value` is the weight (0 for informational entries); `Description` is free text for display, never branch on it. */
        ScoreDetail: {
            /**
             * @description Weight of the entry. Can be negative; 0 for informational entries.
             * @example 10
             */
            Value: number;
            /**
             * @description Human-readable description, for example `Is proxy` or `Antidetect browser (turn_block)`.
             * @example Is proxy
             */
            Description: string;
        };
        /**
         * @description Time of the identification as `YYYY-MM-DD HH:MM:SS.mmm` in UTC, without a zone designator (not RFC 3339). Older rows can lack the milliseconds.
         * @example 2026-09-30 12:34:56.123
         * @example 2026-09-30 13:05:12
         */
        HistoryTimestamp: string;
        /**
         * @description Connection class of one IP address from IP intelligence. Known values: `direct`, `mobile`, `vpn`, `proxy`, `tor`, `privacy_relay` and the empty string when unknown. The set is open: keep values added in later versions.
         * @example direct
         */
        NetworkClass: string;
        /**
         * @description Marketing channel of the visit. Known values: `Google Ads`, `Meta`, `TikTok`, `LinkedIn`, `X`, `Pinterest`, `Microsoft Ads`, `Organic Search`, `Search bot`, `Referral`, `Direct`, `Other` and the empty string. Resolved in this order: a click ID, then UTM parameters, then the referrer (search engines give `Organic Search`, social networks give the platform name, other sites give `Referral`), otherwise `Direct`. Search-engine crawlers get `Search bot`. Empty string on identifications without attribution, such as rate-limit marker rows. The set is open: keep values added in later versions and treat them as `Other`.
         * @example Google Ads
         * @example Direct
         */
        TrafficChannel: string;
        /**
         * @description Group of the marketing channel. Known values: `Paid Search`, `Paid Social`, `Organic`, `Bot`, `Social`, `Referral`, `Direct` and `Other`. History API only; not part of the webhook. The set is open: keep values added in later versions and treat them as `Other`.
         * @example Paid Search
         */
        TrafficChannelGroup: string;
        /**
         * @description Why the channel was chosen. Known values: `gclid_present`, `msclkid_present`, `ttclid_present`, `fbclid_present`, `utm_match`, `referrer_search_engine`, `ip_crawler_detected`, `referrer_social`, `external_referrer` and `no_source_detected`. History API only; not part of the webhook. The set is open: keep values added in later versions.
         * @example gclid_present
         */
        TrafficReason: string;
        /**
         * @description Ad click identifier found in the landing URL. Known values: `gclid`, `gbraid`, `wbraid`, `msclkid`, `ttclid`, `fbclid` and the empty string when there is none. `fbclid` counts only together with a Meta referrer or a Meta `utm_source`. The set is open: keep values added in later versions.
         * @example gclid
         * @example
         */
        ClickIdType: string;
        /**
         * @description One identification as stored, in its latest version. It describes the same identification as a
         *     webhook `data` object, with different field names:
         *
         *     | Webhook `data` | History row |
         *     |---|---|
         *     | `risk_score` | `score` |
         *     | `signals` | `score_details` (JSON-encoded string, zero weights included) |
         *     | `detection_flags` | the `is_*` columns and `check_incomplete` (each column names its flag) |
         *     | `detection_flags.browser_vpn_proxy` | derive it: `connection_type == "browser_vpn_proxy"` |
         *     | `domain` | `site_domain` when present, otherwise `domain` |
         *     | `public_ip` | `ip` (`0.0.0.0` instead of `""`) and `country` |
         *     | `local_ip` | `webrtc_leak_ip` and `webrtc_leak_country` when `webrtc_leak_source` is set and not `none`, otherwise `web_rtc_ip` and `web_rtc_country` |
         *     | `traffic_source` | `traffic_channel`, `referrer_domain`, `entry_url`, `click_id_type`, `utm_*` (omitted when empty) |
         *     | `observed_at` (when scoring finished) | `created_at` (when the identification was made) |
         *
         *     The `ip_mismatch` flag has no column. Rows also carry diagnostic network fields (TCP, MTU and
         *     STUN measurements) that are not part of the stable contract: ignore fields you do not know.
         */
        HistoryRow: {
            request_id: components["schemas"]["RequestId"];
            session_id: components["schemas"]["SessionId"];
            cookie_id: components["schemas"]["CookieId"];
            /**
             * @description Host the identification came from. Can be a subdomain of your registered domain.
             * @example shop.example.com
             */
            domain: string;
            /**
             * @description Your registered domain, present when the identification came from a subdomain. Omitted when empty.
             * @example example.com
             */
            site_domain?: string;
            /**
             * @description User HID exactly as it was passed to the agent (hashed or pseudonymous account identifier). `anonymous` for anonymous checks; `fail`, `-1` and `unknown` also mean "no user". Empty string when no value was stored. Leave the empty string and these values out when you count accounts.
             * @example 9f86d081884c7d659a2feaa0c55ad015
             * @example anonymous
             */
            user_hid: string;
            device_id: components["schemas"]["DeviceId"];
            visitor_id: components["schemas"]["VisitorId"];
            /** @description Public IPv4 address of the HTTP request; `0.0.0.0` when none (for example IPv6 visitors). */
            ip: components["schemas"]["Ipv4"];
            os: components["schemas"]["OperatingSystem"];
            browser: components["schemas"]["Browser"];
            device_type: components["schemas"]["DeviceType"];
            /** @description Country of `ip` as an English country name, or an empty string. */
            country: components["schemas"]["Country"];
            connection_type: components["schemas"]["ConnectionType"];
            score: components["schemas"]["RiskScore"];
            /**
             * @description The entries behind `score` as a JSON-encoded **string** holding an array of
             *     `{"Value": <integer>, "Description": <string>}`. Parse it before use. Scored entries come
             *     first, followed by informational entries with `Value` 0, which can be long. Empty string
             *     when no details were stored.
             *
             *     The webhook `signals` are the entries with a non-zero `Value`, in the same order, with each
             *     description turned into a signal name (for example `Is proxy` becomes `proxy`). Descriptions
             *     are free text for display: never branch on them.
             * @example [{"Value":10,"Description":"Is proxy"},{"Value":0,"Description":"Check Incomplete"}]
             * @example
             */
            score_details: string;
            created_at: components["schemas"]["HistoryTimestamp"];
            /**
             * Format: int64
             * @description Version of the row in Unix milliseconds. It increases every time the row is refined, for example when late network data re-scores it after the webhook was sent.
             * @example 1790771696123
             */
            ver: number;
            /** @description Local IP address observed by the ShieldLabs network check; `0.0.0.0` when none. */
            web_rtc_ip: components["schemas"]["Ipv4"];
            /** @description Country of `web_rtc_ip`, or an empty string. */
            web_rtc_country: components["schemas"]["Country"];
            /** @description Connection class of `web_rtc_ip`, or an empty string. */
            web_rtc_connection_type: components["schemas"]["NetworkClass"];
            /** @description Local network address leaked by the browser; `0.0.0.0` when none. */
            webrtc_leak_ip: components["schemas"]["Ipv4"];
            /** @description Country of `webrtc_leak_ip`, or an empty string. */
            webrtc_leak_country: components["schemas"]["Country"];
            /** @description Connection class of `webrtc_leak_ip`, or an empty string. */
            webrtc_leak_connection_type: components["schemas"]["NetworkClass"];
            /**
             * @description Which check found the local network leak. Known values: `scanner`, `shield`, `none` and the empty string. `none` or an empty string when there is no leak; the webhook `local_ip` then uses `web_rtc_ip`. The set is open: keep values added in later versions.
             * @example none
             */
            webrtc_leak_source: string;
            /** @description Same meaning as `detection_flags.vpn`. */
            is_vpn: boolean;
            /** @description Same meaning as `detection_flags.tor`. */
            is_tor: boolean;
            /** @description Same meaning as `detection_flags.proxy`. */
            is_proxy: boolean;
            /** @description Same meaning as `detection_flags.datacenter_ip`. */
            is_datacenter: boolean;
            /** @description Same meaning as `detection_flags.abuser`. */
            is_abuser: boolean;
            /** @description Same meaning as `detection_flags.privacy_relay`. */
            is_privacy_relay: boolean;
            /** @description Same meaning as `detection_flags.stun_not_checked`. */
            is_stun_not_checked: boolean;
            /** @description Same meaning as `detection_flags.check_incomplete`. Always `false` for search-engine crawlers. */
            check_incomplete: boolean;
            /** @description Same meaning as `detection_flags.anti_detect_browser`. */
            is_antidetect: boolean;
            /** @description Same meaning as `detection_flags.os_mismatch`. */
            is_os_mismatch: boolean;
            /** @description Same meaning as `detection_flags.os_not_detected`. */
            is_os_not_detected: boolean;
            /** @description Same meaning as `detection_flags.timezone_mismatch`. */
            is_timezone_mismatch: boolean;
            /** @description Same meaning as `detection_flags.javascript_disabled`. Always `false` for search-engine crawlers. */
            is_js_disabled: boolean;
            /** @description Same meaning as `detection_flags.browser_automation`. */
            is_browser_automation: boolean;
            /** @description Same meaning as `detection_flags.incognito`. Always `false` for search-engine crawlers. */
            is_incognito: boolean;
            /** @description Same meaning as `detection_flags.search_bot`. */
            is_search_bot: boolean;
            /** @description Same meaning as `detection_flags.suspicious_paid_click`. Omitted when `false`. */
            is_suspicious_paid_click?: boolean;
            /**
             * @description Landing page URL without the `#fragment` (webhook `traffic_source.landing_url`). Omitted when empty. It keeps the query string, which can contain personal data.
             * @example https://shop.example.com/signup?utm_source=google&utm_medium=cpc&gclid=abc123
             */
            entry_url?: string;
            /**
             * @description `utm_source`, lowercased. Omitted when empty.
             * @example google
             */
            utm_source?: string;
            /**
             * @description `utm_medium`, lowercased. Omitted when empty.
             * @example cpc
             */
            utm_medium?: string;
            /**
             * @description `utm_campaign` as sent. Omitted when empty.
             * @example spring_launch
             */
            utm_campaign?: string;
            /**
             * @description `utm_content` as sent. Omitted when empty.
             * @example banner_a
             */
            utm_content?: string;
            /**
             * @description `utm_term` as sent. Omitted when empty.
             * @example device intelligence
             */
            utm_term?: string;
            /** @description Marketing channel (webhook `traffic_source.channel`). Omitted when empty. */
            traffic_channel?: components["schemas"]["TrafficChannel"];
            /** @description Group of the marketing channel. Omitted when empty. */
            traffic_channel_group?: components["schemas"]["TrafficChannelGroup"];
            /** @description Why the channel was chosen. Omitted when empty. */
            traffic_reason?: components["schemas"]["TrafficReason"];
            /**
             * @description Registrable domain of the referrer without `www.`; the crawler name (for example `GoogleBot`) for search-engine crawlers. Omitted when empty.
             * @example news.example.org
             */
            referrer_domain?: string;
            /** @description Ad click identifier type found in the landing URL. Omitted when empty. */
            click_id_type?: components["schemas"]["ClickIdType"];
        } & {
            [key: string]: unknown;
        };
        /** @description One page of identifications, newest first. */
        HistoryPage: {
            /** @description Identifications on this page, ordered by `created_at` descending. Empty when nothing matched. */
            data: components["schemas"]["HistoryRow"][];
            /**
             * @description Number of identifications that match the search in total, across all pages. Page with `offset` while it is below `total`.
             * @example 37
             */
            total: number;
        };
        /** @description Error object sent by the History API and by the Management API rate and load limits. */
        ErrorBody: {
            /**
             * @description Human-readable error message. Branch on the HTTP status, not on this text.
             * @example too many requests
             */
            error: string;
        };
        /**
         * @description JSON text followed by a newline, sent with `Content-Type: text/plain; charset=utf-8`. Parse it as JSON: it holds `{"error": "..."}`.
         * @example {"error":"invalid api key"}
         */
        ErrorBodyText: string;
        /**
         * @description Plain text body.
         * @example 404 page not found
         */
        PlainText: string;
        /**
         * @description HTML error page from the edge proxy. Do not parse it; branch on the status.
         * @example <html><body><h1>502 Bad Gateway</h1></body></html>
         */
        HtmlText: string;
        /**
         * @description A key with every character except the last four replaced by `*`, keeping the original length. Keys of four characters or fewer are returned as they are.
         * @example ****************************a3f8
         */
        MaskedKey: string;
        /** @description Profile of the registered domain. The keys are PascalCase on the wire. Ignore keys you do not know. */
        DomainProfile: {
            /**
             * @description The registered domain, as sent in `X-Shield-Domain`.
             * @example example.com
             */
            Domain: string;
            /**
             * @description Remaining included identifications of the account (shared by its domains). Can be negative when the account is over its included volume.
             * @example 148230
             */
            Weight: number;
            /**
             * @description Legacy field kept for compatibility, normally an empty string. Webhook deliveries do not use it: configure webhook endpoints in the analytics dashboard.
             * @example
             */
            Callback: string;
            /** @description The domain's Public Key, masked. */
            PublicKey: components["schemas"]["MaskedKey"];
            /** @description The domain's Secret Key, masked. */
            Secret: components["schemas"]["MaskedKey"];
            /**
             * Format: date-time
             * @description When the domain was registered, RFC 3339 in UTC with second precision. `0001-01-01T00:00:00Z` when unknown.
             * @example 2026-01-15T09:00:00Z
             */
            CreatedAt: string;
        };
        /** @description One identification as returned by the deprecated Management API history endpoint (PascalCase keys). Also carries diagnostic network fields that are not part of the stable contract. Use the History API row instead. */
        LegacySnapshot: {
            RequestID: components["schemas"]["RequestId"];
            SessionID: components["schemas"]["SessionId"];
            CookieID: components["schemas"]["CookieId"];
            DeviceID: components["schemas"]["DeviceId"];
            VisitorID: components["schemas"]["VisitorId"];
            /** @description Public IPv4 address of the HTTP request. */
            IP: components["schemas"]["Ipv4"];
            ConnectionType: components["schemas"]["ConnectionType"];
            /** @description Local IP address observed by the ShieldLabs network check (not hashed); `0.0.0.0` when none. */
            WebRtcHIP: components["schemas"]["Ipv4"];
            /** @description Country of `WebRtcHIP`, or an empty string. */
            WebRtcCountry: components["schemas"]["Country"];
            /** @description Connection class of `WebRtcHIP`, or an empty string. */
            WebRtcConnectionType: components["schemas"]["NetworkClass"];
            OS: components["schemas"]["OperatingSystem"];
            Browser: components["schemas"]["Browser"];
            DeviceType: components["schemas"]["DeviceType"];
            /** @description Country of `IP` as an English country name, or an empty string. */
            Country: components["schemas"]["Country"];
            /**
             * @description User HID as passed to the agent; `anonymous` for anonymous checks.
             * @example 9f86d081884c7d659a2feaa0c55ad015
             */
            UserHID: string;
            Score: components["schemas"]["RiskScore"];
            /** @description Every entry behind `Score`, informational entries with `Value` 0 included (unlike the History API, this is a parsed array, not a string). */
            Details: components["schemas"]["ScoreDetail"][];
            /**
             * Format: date-time
             * @description Time of the identification, RFC 3339 with fractional seconds.
             * @example 2026-09-30T12:34:56.123Z
             */
            LastRequestTime: string;
        } & {
            [key: string]: unknown;
        };
        /**
         * @description A bare JSON string with the error message, or the JSON literal `null` (an unexpected database error, for example for an IPv6 value).
         * @example fail parse uuid
         * @example null
         */
        LegacyErrorMessage: string | null;
        /** @description Liveness status. */
        HealthStatus: {
            /**
             * @description Always `ok` when the service answers.
             * @constant
             */
            status: "ok";
        };
        /**
         * @description Webhook contract version. Current release 2026-10-06; parsers also accept legacy 2026-06-01.
         * @example 2026-10-06
         * @example 2026-06-01
         */
        SchemaVersion: string;
        /**
         * Format: date-time
         * @description RFC 3339 timestamp in UTC with up to 9 fractional digits (trailing zeros trimmed), for example `2026-09-30T12:34:57.482913041Z`. Parse it with a parser that accepts nanoseconds.
         * @example 2026-09-30T12:34:57.482913041Z
         * @example 2026-09-30T12:34:56Z
         */
        Rfc3339Timestamp: string;
        /**
         * @description User HID: your hashed or pseudonymous account identifier, exactly as it was passed to the
         *     ShieldLabs agent. Pass a hashed value, never a raw email address or database ID.
         *
         *     Values that do not identify a user:
         *     - `anonymous`: an anonymous check;
         *     - `fail`: the agent sent no value;
         *     - `-1` and `unknown`: rows created by ShieldLabs itself, such as rate-limit marker rows.
         *
         *     `null` only when the stored value is an empty string. Leave `null` and the values above out
         *     when you count the accounts of one device, visitor or IP address.
         * @example 9f86d081884c7d659a2feaa0c55ad015
         * @example anonymous
         * @example null
         */
        UserHid: string | null;
        /**
         * @description Dotted IPv4 address, or an empty string when no IPv4 address is known (for example for visitors on IPv6).
         * @example 203.0.113.24
         * @example
         */
        Ipv4OrEmpty: string;
        /** @description An IPv4 address and its country. Both keys are always present and can be empty strings. */
        IpInfo: {
            ip: components["schemas"]["Ipv4OrEmpty"];
            country: components["schemas"]["Country"];
        };
        /** @description Where the visit came from. All nine keys are always present; values can be empty strings. */
        TrafficSource: {
            channel: components["schemas"]["TrafficChannel"];
            /**
             * @description Registrable domain of the referrer without `www.`. For search-engine crawlers, the crawler name (for example `GoogleBot`).
             * @example google.com
             */
            referrer_domain: string;
            /**
             * @description Landing page URL without the `#fragment`. It keeps the query string, which can contain personal data: store it with care.
             * @example https://shop.example.com/signup?utm_source=google&utm_medium=cpc&gclid=abc123
             */
            landing_url: string;
            click_id_type: components["schemas"]["ClickIdType"];
            /**
             * @description `utm_source` query parameter, lowercased.
             * @example google
             */
            utm_source: string;
            /**
             * @description `utm_medium` query parameter, lowercased.
             * @example cpc
             */
            utm_medium: string;
            /**
             * @description `utm_campaign` query parameter as sent.
             * @example spring_launch
             */
            utm_campaign: string;
            /**
             * @description `utm_content` query parameter as sent.
             * @example
             */
            utm_content: string;
            /**
             * @description `utm_term` query parameter as sent.
             * @example
             */
            utm_term: string;
        };
        /** @description One weighted risk signal behind the Risk Score. Only signals with a non-zero weight are listed, in scoring order. The same name can appear twice, and weights can be negative. */
        Signal: {
            /**
             * @description Signal name. The set is open: new names can appear at any time, so keep unknown names and
             *     use them for display and logging only. Known names:
             *     - `tor`: the request came through Tor;
             *     - `vpn`: a VPN was detected;
             *     - `privacy_relay`: a privacy relay such as iCloud Private Relay;
             *     - `proxy`: a proxy was detected;
             *     - `datacenter_ip`: the IP belongs to a datacenter or hosting range;
             *     - `abuser`: the IP has a record of abuse;
             *     - `browser_vpn_proxy`: a VPN or proxy inside the browser;
             *     - `antidetect_browser`: an anti-detect browser (the matching flag is `anti_detect_browser`);
             *     - `proxy_routed_antidetect`: the network check was routed through a proxy in a way typical
             *       for anti-detect browsers;
             *     - `port_scan_routed_via_proxy`: `proxy_routed_antidetect` carried forward from an earlier
             *       identification of the same device and IP;
             *     - `browser_automation`: browser automation, for example a WebDriver-controlled browser;
             *     - `javascript_disabled`: JavaScript or the browser APIs the checks need were unavailable;
             *     - `os_mismatch`: the operating system seen on the network differs from the one the browser
             *       reports;
             *     - `os_not_detected`: the operating system could not be determined;
             *     - `timezone_mismatch`: the browser timezone differs from the IP location timezone;
             *     - `stun_not_checked`: the network (STUN) check did not complete;
             *     - `stun_late_correction`: a late network result arrived; negative weight that cancels
             *       `stun_not_checked`;
             *     - `rate_limited`: the rate-limit marker, weight 999.
             *
             *     A verdict carried forward from an earlier identification of the same device and IP (for
             *     example `antidetect_browser`) keeps a name derived from the original signal and can carry a
             *     partial weight.
             * @example proxy
             * @example antidetect_browser
             */
            name: string;
            /**
             * @description Points the signal contributed. Can be negative (`stun_late_correction` is -30) and is 999 for `rate_limited`. Weights can change between releases; never add them up yourself.
             * @example 10
             * @example -30
             */
            weight: number;
        };
        /**
         * @description Stable yes/no verdicts for the identification. Legacy 19 keys are always present; the four extension flags are present in schema 2026-10-06. Branch on these flags and on
         *     the Risk Score; signal names are for display and logging.
         *
         *     When `search_bot` is `true`, `incognito`, `check_incomplete`, `ip_mismatch` and
         *     `javascript_disabled` are always `false`.
         */
        DetectionFlags: {
            /** @description A VPN was detected (scored `vpn` signal). */
            vpn: boolean;
            /** @description A privacy relay such as iCloud Private Relay was detected. */
            privacy_relay: boolean;
            /** @description A VPN or proxy built into the browser or one of its extensions. `true` exactly when `connection_type` is `browser_vpn_proxy`. */
            browser_vpn_proxy: boolean;
            /** @description The request came through the Tor network. */
            tor: boolean;
            /** @description A proxy was detected. */
            proxy: boolean;
            /** @description The public IP belongs to a datacenter or hosting range. */
            datacenter_ip: boolean;
            /** @description The public IP has a record of abuse in IP intelligence. */
            abuser: boolean;
            /** @description The operating system seen on the network differs from the one the browser reports. */
            os_mismatch: boolean;
            /** @description The operating system could not be determined from the User-Agent or the network. */
            os_not_detected: boolean;
            /** @description The browser timezone differs from the timezone of the IP location. */
            timezone_mismatch: boolean;
            /** @description An anti-detect browser was detected. */
            anti_detect_browser: boolean;
            /** @description Browser automation was detected, for example a WebDriver-controlled browser. */
            browser_automation: boolean;
            /** @description The public IP differs from the local IP found by the browser network check. Informational: it does not add to the score. */
            ip_mismatch: boolean;
            /** @description The browser runs in a private window. */
            incognito: boolean;
            /** @description A search-engine crawler. Its Risk Score is always 0. */
            search_bot: boolean;
            /** @description The visit came from a paid ad click (Google Ads, Meta, TikTok, Microsoft Ads, LinkedIn, Pinterest or X) and the Risk Score is 60 or more (the 999 marker included). */
            suspicious_paid_click: boolean;
            /** @description JavaScript, or the browser APIs the checks need, were unavailable. */
            javascript_disabled: boolean;
            /** @description The browser network (STUN) check did not complete. Cleared again when a late network result arrives. */
            stun_not_checked: boolean;
            /** @description Part of the browser checks timed out, so the verdict rests on partial data. Informational. */
            check_incomplete: boolean;
            os_mismatch2?: boolean;
            device_spoofing?: boolean;
            latency_test?: boolean;
            banned_ip?: boolean;
        };
        RiskEvent: {
            code: string;
            /** @description Final scoring flag. false does not assert that every underlying probe completed. */
            detected: boolean;
            /** @description Catalogue weight, not an additive score. Banned IP 999 is a marker. */
            weight: number;
            /** @description Matching score details, may contain corrections. Never recompute risk_score by summing. */
            contribution: number;
            /**
             * @description The final scoring flag has been evaluated. Probe incompleteness is reported by dedicated risk events.
             * @example evaluated
             */
            status: string;
        };
        HREResult: {
            /**
             * @example evaluated
             * @example not_evaluated
             * @example not_applicable
             */
            status: string;
            /**
             * @example medium
             * @example high
             * @example null
             */
            level: string | null;
            reason: string;
            devices?: number;
            min_devices?: number;
        };
        /** @description Three completed on-demand handler results. Technical errors block emission; no_history/skipped are explicit not_evaluated results. Anonymous checks are not_applicable. Multiaccount is separate. */
        HRE: {
            rules_version?: string;
            account_sharing: components["schemas"]["HREResult"];
            account_takeover: components["schemas"]["HREResult"];
            impossible_travel: components["schemas"]["HREResult"];
        };
        /** @description FP21 for tracked users. Legacy sharing/takeover/travel mirrors are retained; prefer data.hre. Absent on anonymous checks. */
        Fingerprint: {
            outcome: string;
            record_id?: string;
            /** @description FP21 hardware identity, distinct from device_id. */
            hardware_id?: string;
            rules_version: string;
            sharing?: Record<string, never>;
            takeover?: Record<string, never>;
            travel?: Record<string, never>;
        };
        /** @description Final identification. risk_score is this scan only; no all-time entity risk. New extension fields are required by version 2026-10-06; legacy bodies remain accepted. */
        IdentificationScoredData: {
            request_id: components["schemas"]["RequestId"];
            visitor_id: components["schemas"]["VisitorId"];
            device_id: components["schemas"]["DeviceId"];
            session_id: components["schemas"]["SessionId"];
            cookie_id: components["schemas"]["CookieId"];
            user_hid: components["schemas"]["UserHid"];
            /**
             * @description Registered domain of your site (the request host when no registered domain matched).
             * @example example.com
             */
            domain: string;
            /** @description Public IPv4 address of the HTTP request and its country. `ip` is empty when the request did not arrive over IPv4. */
            public_ip: components["schemas"]["IpInfo"];
            /** @description Local IP address found by the browser network check (WebRTC): the leaked address when a local network leak was found, otherwise the address ShieldLabs observed. Both keys are empty when the check found nothing. */
            local_ip: components["schemas"]["IpInfo"];
            connection_type: components["schemas"]["ConnectionType"];
            os: components["schemas"]["OperatingSystem"];
            browser: components["schemas"]["Browser"];
            device_type: components["schemas"]["DeviceType"];
            traffic_source: components["schemas"]["TrafficSource"];
            risk_score: components["schemas"]["RiskScore"];
            /** @description Weighted risk signals behind `risk_score`, in scoring order. Can be empty. The rate-limit marker carries exactly one entry, `{"name":"rate_limited","weight":999}`. */
            signals: components["schemas"]["Signal"][];
            detection_flags: components["schemas"]["DetectionFlags"];
            /** @description Original snapshot scan clock, distinct from envelope created_at. RFC 3339 in UTC with up to 9 fractional digits. */
            observed_at: components["schemas"]["Rfc3339Timestamp"];
            result_version?: string;
            /** @description Core build source revision; core:unversioned on local builds. */
            scoring_version?: string;
            risk_events?: components["schemas"]["RiskEvent"][];
            hre?: components["schemas"]["HRE"];
            fingerprint?: components["schemas"]["Fingerprint"];
        };
        /** @description Body of an `identification.scored` delivery. The signature is not part of the body: it arrives in the `X-Shield-Signature` header. */
        IdentificationScoredEvent: {
            /**
             * @description Event type. Ignore events whose type you do not know instead of failing.
             * @constant
             */
            event_type: "identification.scored";
            schema_version: components["schemas"]["SchemaVersion"];
            /** @description When the event envelope was created, distinct from data.observed_at (scan time). */
            created_at: components["schemas"]["Rfc3339Timestamp"];
            data: components["schemas"]["IdentificationScoredData"];
            /** @description Logical site/request/final-result-version/type identity. Stable across retries and endpoints. */
            event_id?: string;
            /** @description Site scope when available; legacy domain-only accounts omit it. */
            site_id?: number;
        } & unknown;
        /** @description Body of a `webhook.ping` delivery, sent when you verify an endpoint. It has no `data`. The keys arrive sorted alphabetically and `created_at` has second precision. */
        WebhookPingEvent: {
            /**
             * @description Event type.
             * @constant
             */
            event_type: "webhook.ping";
            schema_version: components["schemas"]["SchemaVersion"];
            /** @description When the ping was sent, with second precision. */
            created_at: components["schemas"]["Rfc3339Timestamp"];
            event_id?: string;
        };
    };
    responses: {
        /** @description The `Authorization` header is missing or is not a Bearer token, or the Private API Key is unknown, deleted or belongs to a disabled domain. The body is JSON text sent with `Content-Type: text/plain; charset=utf-8`: parse it as JSON anyway. Do not retry. */
        HistoryUnauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "text/plain": components["schemas"]["ErrorBodyText"];
            };
        };
        /** @description No route matches the method and path, for example because the base URL repeats part of the path or a path value is empty or contains `/`. Plain text body. Check the URL; do not retry. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "text/plain": components["schemas"]["PlainText"];
            };
        };
        /** @description More than about 15 requests in the current second for this domain (all callers of the domain share the limit). There is no ban: retry after about a second, with backoff. */
        HistoryTooManyRequests: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorBody"];
            };
        };
        /**
         * @description Server error.
         *     - `application/json`: the query failed. A malformed UUID or IPv4 value always ends here with the
         *       raw database message, so validate the path before sending and do not retry such a request.
         *       Other failures are transient.
         *     - `text/plain` (JSON text): the key lookup failed. Transient: retry with backoff.
         */
        HistoryServerError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorBody"];
                "text/plain": components["schemas"]["ErrorBodyText"];
            };
        };
        /** @description The edge proxy could not reach the service. HTML body. Retry with backoff. */
        BadGateway: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "text/html": components["schemas"]["HtmlText"];
            };
        };
        /** @description The service did not answer the edge proxy in time. HTML body. Retry with backoff. */
        GatewayTimeout: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "text/html": components["schemas"]["HtmlText"];
            };
        };
        /** @description Empty body, no `Content-Type`. `X-Shield-Domain` or `Authorization` is missing or malformed, the domain is unknown or disabled, or the Secret Key is wrong. Do not retry. */
        ManagementUnauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content?: never;
        };
        /** @description More than 15 requests in the current minute from your IP, or a 10-minute block is active. The request that exceeds the limit starts the block, and every request during it gets this answer. Do not retry: wait for the block to end and cache results to stay under the limit. */
        ManagementTooManyRequests: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorBody"];
            };
        };
        /** @description Too many requests are in flight on the server. Retry with backoff. */
        ManagementServerBusy: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorBody"];
            };
        };
    };
    parameters: {
        /**
         * @description Identifier to search by. Only these seven values are supported:
         *     - `request_id`: one identification (read a verdict);
         *     - `device_id`: every identification of one device;
         *     - `user_hid`: every identification of one account;
         *     - `visitor_id`: every identification of one visitor;
         *     - `ip`: every identification from one public IPv4 address;
         *     - `session_id`: every identification of one visit;
         *     - `cookie_id`: every identification with one browser cookie.
         *
         *     The server does not reject other values: it ignores them and returns the latest identifications
         *     of the whole domain, so restrict the value on your side.
         */
        HistorySearchType: "request_id" | "device_id" | "user_hid" | "visitor_id" | "ip" | "session_id" | "cookie_id";
        /**
         * @description Value of the identifier, validated on your side before sending:
         *     - `request_id`, `device_id`, `visitor_id`, `session_id`, `cookie_id`: a UUID of any version,
         *       the nil UUID included, matching
         *       `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`. Send it
         *       lowercase.
         *     - `ip`: a dotted IPv4 address. IPv6 addresses cannot be searched.
         *     - `user_hid`: the exact, case-sensitive User HID as one path segment, encoded the way the
         *       server reads it: send the characters `A-Z a-z 0-9 - . _ ~ $ & + , : ; = @` unescaped and
         *       percent-encode every other byte of the UTF-8 value as uppercase `%XX`, including
         *       `! ' ( ) *`, spaces and `%` itself. The server compares any other encoding literally, so
         *       `%40` instead of `@`, or lowercase hex digits, return an empty page instead of the matching
         *       rows. Many HTTP clients and generated clients escape `$ & + , : ; = @` in path values: build
         *       this path yourself when yours does. A User HID that contains `/` cannot be searched, and most
         *       HTTP clients cannot send `.` or `..` because they remove them as dot segments; the pattern
         *       rejects these values. Hex-encoded hashes need no escaping at all.
         *
         *     The server does not validate the value: a malformed UUID or IPv4 address gets a `500`.
         */
        HistoryValue: string;
        /** @description Maximum number of identifications to return, from 1 to 100. The server replaces any other value (and a non-numeric one) with 20 instead of clamping it, so validate it on your side. */
        HistoryLimit: number;
        /** @description Number of identifications to skip, for paging. The server treats negative or non-numeric values as 0. Rows are ordered by `created_at` only, so paging while new identifications arrive can repeat or skip rows: deduplicate on `request_id`. */
        HistoryOffset: number;
        /** @description Your registered domain. The server matches it exactly against the domain registered in the analytics dashboard, so send it normalized: lowercase, without scheme, path, trailing slash or a leading `www.` (`https://www.Example.com/` becomes `example.com`). A missing or wrong value gets a `401` with an empty body. */
        ShieldDomain: string;
        /** @description Identifier to search by. Other values get a `404` with a bare JSON string such as `"auto is not supported"`. */
        DeprecatedHistoryType: "request_id" | "device_id" | "user_hid" | "visitor_id" | "ip" | "session_id" | "cookie_id";
        /** @description Value of the identifier. UUID types accept a UUID of any version; `ip` must be an IP address (an IPv6 address passes validation but then fails with `400` and a `null` body); `user_hid` is free text. */
        DeprecatedHistoryValue: string;
        /** @description Maximum number of identifications, from 1 to 100. Any other value becomes 100. There is no `offset`. */
        DeprecatedHistoryLimit: number;
        /**
         * @description `sha256=` followed by the lowercase hex HMAC-SHA256 of the raw request body:
         *     - key: your endpoint's signing secret as UTF-8 bytes, the `whsec_` prefix included (not hex- or
         *       base64-decoded, not stripped);
         *     - message: the exact bytes of the body as received.
         *
         *     Compare it with your own digest in constant time, before parsing the JSON. The example values
         *     are the signatures of the example bodies (in their compact form as sent) with the test secret
         *     `whsec_00112233445566778899aabbccddeeff`.
         */
        ShieldSignature: string;
        /** @description Convenience mirror of signed body event_id. Trust the body after HMAC verification. Absent on older bodies. Retries reuse the logical ID across attempts; it is not a separate delivery-attempt identity. */
        ShieldEventId: string;
    };
    requestBodies: never;
    headers: {
        /** @description Marks the endpoint as deprecated. The value is the literal `true`. */
        Deprecation: "true";
        /** @description HTTP date after which the endpoint stops working. */
        Sunset: "Sat, 01 Jan 2027 00:00:00 GMT";
        /** @description Points to the replacement endpoint with `rel="successor-version"`. */
        Link: "<https://account.shieldlabs.ai/api/v1/history>; rel=\"successor-version\"";
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    searchHistory: {
        parameters: {
            query?: {
                /** @description Maximum number of identifications to return, from 1 to 100. The server replaces any other value (and a non-numeric one) with 20 instead of clamping it, so validate it on your side. */
                limit?: components["parameters"]["HistoryLimit"];
                /** @description Number of identifications to skip, for paging. The server treats negative or non-numeric values as 0. Rows are ordered by `created_at` only, so paging while new identifications arrive can repeat or skip rows: deduplicate on `request_id`. */
                offset?: components["parameters"]["HistoryOffset"];
            };
            header?: never;
            path: {
                /**
                 * @description Identifier to search by. Only these seven values are supported:
                 *     - `request_id`: one identification (read a verdict);
                 *     - `device_id`: every identification of one device;
                 *     - `user_hid`: every identification of one account;
                 *     - `visitor_id`: every identification of one visitor;
                 *     - `ip`: every identification from one public IPv4 address;
                 *     - `session_id`: every identification of one visit;
                 *     - `cookie_id`: every identification with one browser cookie.
                 *
                 *     The server does not reject other values: it ignores them and returns the latest identifications
                 *     of the whole domain, so restrict the value on your side.
                 */
                search_type: components["parameters"]["HistorySearchType"];
                /**
                 * @description Value of the identifier, validated on your side before sending:
                 *     - `request_id`, `device_id`, `visitor_id`, `session_id`, `cookie_id`: a UUID of any version,
                 *       the nil UUID included, matching
                 *       `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`. Send it
                 *       lowercase.
                 *     - `ip`: a dotted IPv4 address. IPv6 addresses cannot be searched.
                 *     - `user_hid`: the exact, case-sensitive User HID as one path segment, encoded the way the
                 *       server reads it: send the characters `A-Z a-z 0-9 - . _ ~ $ & + , : ; = @` unescaped and
                 *       percent-encode every other byte of the UTF-8 value as uppercase `%XX`, including
                 *       `! ' ( ) *`, spaces and `%` itself. The server compares any other encoding literally, so
                 *       `%40` instead of `@`, or lowercase hex digits, return an empty page instead of the matching
                 *       rows. Many HTTP clients and generated clients escape `$ & + , : ; = @` in path values: build
                 *       this path yourself when yours does. A User HID that contains `/` cannot be searched, and most
                 *       HTTP clients cannot send `.` or `..` because they remove them as dot segments; the pattern
                 *       rejects these values. Hex-encoded hashes need no escaping at all.
                 *
                 *     The server does not validate the value: a malformed UUID or IPv4 address gets a `500`.
                 */
                value: components["parameters"]["HistoryValue"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching identifications, newest first. `data` is empty when nothing matched. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HistoryPage"];
                };
            };
            401: components["responses"]["HistoryUnauthorized"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["HistoryTooManyRequests"];
            500: components["responses"]["HistoryServerError"];
            502: components["responses"]["BadGateway"];
            504: components["responses"]["GatewayTimeout"];
        };
    };
    getDomainProfile: {
        parameters: {
            query?: never;
            header: {
                /** @description Your registered domain. The server matches it exactly against the domain registered in the analytics dashboard, so send it normalized: lowercase, without scheme, path, trailing slash or a leading `www.` (`https://www.Example.com/` becomes `example.com`). A missing or wrong value gets a `401` with an empty body. */
                "X-Shield-Domain": components["parameters"]["ShieldDomain"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The domain profile. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DomainProfile"];
                };
            };
            401: components["responses"]["ManagementUnauthorized"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["ManagementTooManyRequests"];
            502: components["responses"]["BadGateway"];
            503: components["responses"]["ManagementServerBusy"];
            504: components["responses"]["GatewayTimeout"];
        };
    };
    searchHistoryDeprecated: {
        parameters: {
            query?: {
                /** @description Maximum number of identifications, from 1 to 100. Any other value becomes 100. There is no `offset`. */
                limit?: components["parameters"]["DeprecatedHistoryLimit"];
            };
            header: {
                /** @description Your registered domain. The server matches it exactly against the domain registered in the analytics dashboard, so send it normalized: lowercase, without scheme, path, trailing slash or a leading `www.` (`https://www.Example.com/` becomes `example.com`). A missing or wrong value gets a `401` with an empty body. */
                "X-Shield-Domain": components["parameters"]["ShieldDomain"];
            };
            path: {
                /** @description Identifier to search by. Other values get a `404` with a bare JSON string such as `"auto is not supported"`. */
                type: components["parameters"]["DeprecatedHistoryType"];
                /** @description Value of the identifier. UUID types accept a UUID of any version; `ip` must be an IP address (an IPv6 address passes validation but then fails with `400` and a `null` body); `user_hid` is free text. */
                value: components["parameters"]["DeprecatedHistoryValue"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching identifications, newest first. */
            200: {
                headers: {
                    Deprecation: components["headers"]["Deprecation"];
                    Sunset: components["headers"]["Sunset"];
                    Link: components["headers"]["Link"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LegacySnapshot"][];
                };
            };
            /** @description The value failed validation (a bare JSON string) or the query failed (the JSON literal `null`, for example for an IPv6 `ip` value). Do not retry. */
            400: {
                headers: {
                    Deprecation: components["headers"]["Deprecation"];
                    Sunset: components["headers"]["Sunset"];
                    Link: components["headers"]["Link"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LegacyErrorMessage"];
                };
            };
            /** @description Empty body, no `Content-Type`. Missing or malformed headers, unknown or disabled domain, or a wrong Secret Key. Do not retry. */
            401: {
                headers: {
                    Deprecation: components["headers"]["Deprecation"];
                    Sunset: components["headers"]["Sunset"];
                    Link: components["headers"]["Link"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description `application/json`: the `type` is not supported (a bare JSON string); this answer carries the deprecation headers. `text/plain`: no route matches the path, for example because the value is empty or contains `/`; this answer comes from the router and carries no deprecation headers. Do not retry. */
            404: {
                headers: {
                    Deprecation: components["headers"]["Deprecation"];
                    Sunset: components["headers"]["Sunset"];
                    Link: components["headers"]["Link"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LegacyErrorMessage"];
                    "text/plain": components["schemas"]["PlainText"];
                };
            };
            429: components["responses"]["ManagementTooManyRequests"];
            502: components["responses"]["BadGateway"];
            503: components["responses"]["ManagementServerBusy"];
            504: components["responses"]["GatewayTimeout"];
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The service is up. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthStatus"];
                };
            };
            /** @description No route matches the path. The health check lives at the host root, so `/api/health` gets this answer. Plain text body. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": components["schemas"]["PlainText"];
                };
            };
            502: components["responses"]["BadGateway"];
            504: components["responses"]["GatewayTimeout"];
        };
    };
    identificationScored: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description `sha256=` followed by the lowercase hex HMAC-SHA256 of the raw request body:
                 *     - key: your endpoint's signing secret as UTF-8 bytes, the `whsec_` prefix included (not hex- or
                 *       base64-decoded, not stripped);
                 *     - message: the exact bytes of the body as received.
                 *
                 *     Compare it with your own digest in constant time, before parsing the JSON. The example values
                 *     are the signatures of the example bodies (in their compact form as sent) with the test secret
                 *     `whsec_00112233445566778899aabbccddeeff`.
                 */
                "X-Shield-Signature": components["parameters"]["ShieldSignature"];
                /** @description Convenience mirror of signed body event_id. Trust the body after HMAC verification. Absent on older bodies. Retries reuse the logical ID across attempts; it is not a separate delivery-attempt identity. */
                "X-Shield-Event-Id"?: components["parameters"]["ShieldEventId"];
            };
            path?: never;
            cookie?: never;
        };
        /** @description The event as compact JSON. Verify the signature over these exact bytes. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["IdentificationScoredEvent"];
            };
        };
        responses: {
            /** @description Delivery accepted. The response body is ignored. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Permanent 4xx are terminal; 429 is retried. 2xx acknowledges durable acceptance. */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    webhookPing: {
        parameters: {
            query?: never;
            header: {
                /**
                 * @description `sha256=` followed by the lowercase hex HMAC-SHA256 of the raw request body:
                 *     - key: your endpoint's signing secret as UTF-8 bytes, the `whsec_` prefix included (not hex- or
                 *       base64-decoded, not stripped);
                 *     - message: the exact bytes of the body as received.
                 *
                 *     Compare it with your own digest in constant time, before parsing the JSON. The example values
                 *     are the signatures of the example bodies (in their compact form as sent) with the test secret
                 *     `whsec_00112233445566778899aabbccddeeff`.
                 */
                "X-Shield-Signature": components["parameters"]["ShieldSignature"];
                /** @description Convenience mirror of signed body event_id. Trust the body after HMAC verification. Absent on older bodies. Retries reuse the logical ID across attempts; it is not a separate delivery-attempt identity. */
                "X-Shield-Event-Id"?: components["parameters"]["ShieldEventId"];
            };
            path?: never;
            cookie?: never;
        };
        /** @description The ping as compact JSON with sorted keys. */
        requestBody: {
            content: {
                "application/json": components["schemas"]["WebhookPingEvent"];
            };
        };
        responses: {
            /** @description Endpoint verified. The response body is ignored. */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Verification failed. Any status other than 2xx, and a timeout after 5 seconds, fails it. */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}

// Pure attribution logic for cw-post-attribution-join. No I/O so it is unit-testable.
// Exclusion basis is the one used by posthog-conversion-monitor v9 (posthog_conversion_daily.raw_event_counts.dda_canonical):
//   browser_identity_cohort_any_test_marker + replay-signature scanner exclusion + server-classified internal journeys.

export const JOIN_METHOD = 'exact_utm_campaign_content';
export const EXCLUSION_BASIS =
  'browser_identity_cohort_any_test_marker (controlled_test|test_run, 180d) + replay-signature scanner rule ' +
  '(active<=10s, 18-35s replay, 3-4 clicks, 0 keypress, 15-25 mouse events) + cw-verify-* and server-classified internal journeys';
export const LOOKBACK_DAYS = 120;

const SAMPLE = 'irr_sample_page_viewed';
const CHECKOUT = 'irr_checkout_started';
const PURCHASE = 'irr_purchase_completed';
export const DOWNSTREAM_EVENTS = [SAMPLE, CHECKOUT, PURCHASE] as const;

// Landing predicate: standard UTM, exact source+medium, both join keys present.
const LANDING_WHERE = `event = '$pageview'
  AND timestamp > now() - INTERVAL ${LOOKBACK_DAYS} DAY
  AND properties.utm_source = 'linkedin' AND properties.utm_medium = 'organic_social'
  AND notEmpty(toString(properties.utm_campaign)) AND notEmpty(toString(properties.utm_content))
  AND notEmpty(toString(properties.$session_id))`;

const TEST_COHORT = `(SELECT distinct_id FROM events WHERE (properties.controlled_test = true OR properties.test_run = true)
  AND timestamp > now() - INTERVAL 180 DAY)`;
const SCANNER_SESSIONS = `(SELECT session_id FROM session_replay_events
  WHERE start_time > now() - INTERVAL ${LOOKBACK_DAYS} DAY
    AND active_milliseconds <= 10000 AND dateDiff('second', start_time, end_time) BETWEEN 18 AND 35
    AND click_count BETWEEN 3 AND 4 AND keypress_count = 0 AND mouse_activity_count BETWEEN 15 AND 25)`;

export const LANDING_QUERY = `SELECT toString(properties.utm_campaign) AS utm_campaign, toString(properties.utm_content) AS utm_content,
  toString(properties.$session_id) AS sid, distinct_id,
  anyIf(toString(properties.journey_id), notEmpty(toString(properties.journey_id))) AS journey_id,
  max(if(properties.controlled_test = true OR properties.test_run = true, 1, 0)) AS test_marked,
  max(if(distinct_id IN ${TEST_COHORT}, 1, 0)) AS test_identity,
  max(if(toString(properties.$session_id) IN ${SCANNER_SESSIONS}, 1, 0)) AS scanner
FROM events WHERE ${LANDING_WHERE}
GROUP BY utm_campaign, utm_content, sid, distinct_id`;

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const lit = (ids: Iterable<string | null | undefined>) =>
  [...new Set([...ids].filter((x): x is string => !!x && SAFE_ID.test(x)))].map(x => `'${x}'`).join(',');

/** Downstream events for the landing sessions/journeys already found (small IN lists; avoids nested scans that time out in PostHog).
 *  Session-level exclusions (test identity, scanner) are inherited from the landing session in attributePosts. Returns null if nothing to look up. */
export function buildDownstreamQuery(landing: { sid: string; journey_id: string | null }[]): string | null {
  const sids = lit(landing.map(r => r.sid)), jids = lit(landing.map(r => r.journey_id));
  if (!sids && !jids) return null;
  const conds = [sids && `toString(properties.$session_id) IN (${sids})`, jids && `toString(properties.journey_id) IN (${jids})`].filter(Boolean).join(' OR ');
  return `SELECT toString(properties.$session_id) AS sid, event, distinct_id, toString(properties.journey_id) AS journey_id,
  max(if(properties.controlled_test = true OR properties.test_run = true, 1, 0)) AS test_marked
FROM events
WHERE event IN (${DOWNSTREAM_EVENTS.map(e => `'${e}'`).join(',')})
  AND timestamp > now() - INTERVAL ${LOOKBACK_DAYS} DAY
  AND (${conds})
GROUP BY sid, event, distinct_id, journey_id`;
}

export interface LandingRow { utm_campaign: string; utm_content: string; sid: string; distinct_id: string; journey_id: string | null; test_marked: number; test_identity: number; scanner: number }
export interface EventRow { sid: string; event: string; distinct_id: string; journey_id: string | null; test_marked: number; test_identity?: number; scanner?: number }
export interface PostRef { id: string; utm_campaign: string | null; utm_content: string | null; published_at: string; governed_state?: string | null; is_controlled_test?: boolean }
export type Confidence = 'high' | 'medium' | 'insufficient_evidence';

export interface Exclusions { test_marker: number; scanner: number; internal_journey: number }
export interface PostResult {
  id: string;
  clicks: number | null; sample_views: number | null; checkout_starts: number | null; purchases: number | null;
  qualified_events: number | null;
  join_method: string | null; confidence: Confidence; notes: string;
  excluded_landing_sessions: Exclusions;
}

export type ExclusionReason = 'test_marker' | 'scanner' | 'internal_journey' | null;

export function exclusionReason(r: { test_marked: number; test_identity?: number; scanner?: number; journey_id: string | null; distinct_id: string },
  internalJourneys: Set<string>, internalBrowsers: Set<string>): ExclusionReason {
  if (Number(r.test_marked) > 0 || Number(r.test_identity) > 0) return 'test_marker';
  const j = r.journey_id ?? '';
  if (j.startsWith('cw-verify-') || (j && internalJourneys.has(j)) || internalBrowsers.has(r.distinct_id)) return 'internal_journey';
  if (Number(r.scanner) > 0) return 'scanner';
  return null;
}

export function classifyConfidence(a: { tagged: boolean; queryOk: boolean; notYetPublished: boolean; landingSessions: number }): { confidence: Confidence; reason: string } {
  if (!a.tagged) return { confidence: 'insufficient_evidence', reason: 'no utm_campaign+utm_content on row; no exact join possible' };
  if (!a.queryOk) return { confidence: 'insufficient_evidence', reason: 'PostHog query failed; no counts inferred' };
  if (a.notYetPublished) return { confidence: 'insufficient_evidence', reason: 'post not yet published' };
  if (a.landingSessions > 0) return { confidence: 'high', reason: 'exact utm_campaign+utm_content match, qualified landing sessions observed' };
  return { confidence: 'medium', reason: 'exact tags present but zero qualified landing sessions: genuine zero clicks cannot be told apart from untracked clicks' };
}

export function attributePosts(posts: PostRef[], landing: LandingRow[], events: EventRow[],
  opts: { now: Date; internalJourneys?: Set<string>; queryOk?: boolean }): PostResult[] {
  const internalJourneys = opts.internalJourneys ?? new Set<string>();
  const queryOk = opts.queryOk ?? true;
  // browsers that share a journey classified internal are internal everywhere
  const internalBrowsers = new Set<string>();
  for (const r of landing) {
    const j = r.journey_id ?? '';
    if (j.startsWith('cw-verify-') || (j && internalJourneys.has(j))) internalBrowsers.add(r.distinct_id);
  }
  return posts.map((p): PostResult => {
    const tagged = !!(p.utm_campaign && p.utm_content);
    // Any post whose published time is still ahead is not yet published, whatever its governed state: counting it now would write a zero before it has gone out.
    const notYetPublished = new Date(p.published_at) > opts.now;
    const empty: Exclusions = { test_marker: 0, scanner: 0, internal_journey: 0 };
    if (!tagged || !queryOk || notYetPublished) {
      const c = classifyConfidence({ tagged, queryOk, notYetPublished, landingSessions: 0 });
      return { id: p.id, clicks: null, sample_views: null, checkout_starts: null, purchases: null, qualified_events: null,
        join_method: null, confidence: c.confidence, notes: c.reason, excluded_landing_sessions: empty };
    }
    const mine = landing.filter(r => r.utm_campaign === p.utm_campaign && r.utm_content === p.utm_content);
    const excl: Exclusions = { test_marker: 0, scanner: 0, internal_journey: 0 };
    const valid = new Map<string, LandingRow>();
    for (const r of mine) {
      const why = exclusionReason(r, internalJourneys, internalBrowsers);
      if (why) excl[why]++; else valid.set(r.sid, r);
    }
    const byJourney = new Map<string, string>();
    for (const r of valid.values()) if (r.journey_id) byJourney.set(r.journey_id, r.sid);
    const seen: Record<string, Set<string>> = { [SAMPLE]: new Set(), [CHECKOUT]: new Set(), [PURCHASE]: new Set() };
    for (const e of events) {
      const unit = valid.has(e.sid) ? e.sid : (e.journey_id && byJourney.get(e.journey_id)) || null;
      if (!unit) continue;
      if (exclusionReason(e, internalJourneys, internalBrowsers)) continue;
      seen[e.event]?.add(unit);
    }
    const clicks = valid.size;
    const sample = seen[SAMPLE].size, checkout = seen[CHECKOUT].size, purchases = seen[PURCHASE].size;
    const c = classifyConfidence({ tagged, queryOk, notYetPublished, landingSessions: clicks });
    const exTotal = excl.test_marker + excl.scanner + excl.internal_journey;
    const notes = `${c.reason}. clicks=qualified landing sessions. downstream counted only where event shares $session_id or journey_id with the landing session` +
      (exTotal ? `; excluded landing sessions: test_marker=${excl.test_marker}, scanner=${excl.scanner}, internal_journey=${excl.internal_journey}` : '');
    return { id: p.id, clicks, sample_views: sample, checkout_starts: checkout, purchases,
      qualified_events: sample + checkout + purchases, join_method: JOIN_METHOD, confidence: c.confidence, notes, excluded_landing_sessions: excl };
  });
}

/** Tagged sessions whose (campaign, content) match no row: reported, never silently dropped or guessed. */
export function orphanTags(posts: PostRef[], landing: LandingRow[]): { utm_campaign: string; utm_content: string; sessions: number }[] {
  const known = new Set(posts.filter(p => p.utm_campaign && p.utm_content).map(p => `${p.utm_campaign}|${p.utm_content}`));
  const m = new Map<string, number>();
  for (const r of landing) { const k = `${r.utm_campaign}|${r.utm_content}`; if (!known.has(k)) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].map(([k, n]) => { const [utm_campaign, utm_content] = k.split('|'); return { utm_campaign, utm_content, sessions: n }; });
}

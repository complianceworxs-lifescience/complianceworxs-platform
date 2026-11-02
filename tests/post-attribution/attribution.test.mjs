import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributePosts, classifyConfidence, exclusionReason, orphanTags, JOIN_METHOD, LANDING_QUERY, buildDownstreamQuery } from '../../edge-functions/_shared/post-attribution.ts';

const NOW = new Date('2026-11-10T12:00:00Z');
const post = (o = {}) => ({ id: 'p1', utm_campaign: 'offer-20261103', utm_content: 'a'.repeat(24), published_at: '2026-11-03T16:00:00Z', governed_state: 'published', ...o });
const land = (o = {}) => ({ utm_campaign: 'offer-20261103', utm_content: 'a'.repeat(24), sid: 's1', distinct_id: 'd1', journey_id: 'j1', test_marked: 0, test_identity: 0, scanner: 0, ...o });
const ev = (event, o = {}) => ({ sid: 's1', event, distinct_id: 'd1', journey_id: 'j1', test_marked: 0, test_identity: 0, scanner: 0, ...o });

test('exact campaign+content join counts sessions and downstream events', () => {
  const [r] = attributePosts([post()], [land(), land({ sid: 's2', distinct_id: 'd2', journey_id: 'j2' })],
    [ev('irr_sample_page_viewed'), ev('irr_checkout_started'), ev('irr_purchase_completed', { sid: '', journey_id: 'j2', distinct_id: 'd2' })], { now: NOW });
  assert.equal(r.join_method, JOIN_METHOD);
  assert.equal(r.clicks, 2);
  assert.equal(r.sample_views, 1);
  assert.equal(r.checkout_starts, 1);
  assert.equal(r.purchases, 1); // matched by journey_id when the event carries no session id
  assert.equal(r.qualified_events, 3);
  assert.equal(r.confidence, 'high');
});

test('a different utm_content never leaks in (no day-level or campaign-only inference)', () => {
  const [r] = attributePosts([post()], [land({ utm_content: 'b'.repeat(24) })], [ev('irr_sample_page_viewed')], { now: NOW });
  assert.equal(r.clicks, 0);
  assert.equal(r.sample_views, 0);
  assert.equal(r.confidence, 'medium');
  const [o] = orphanTags([post()], [land({ utm_content: 'b'.repeat(24) })]);
  assert.equal(o.sessions, 1);
});

test('test marker, test identity, scanner and internal journeys are excluded and itemised', () => {
  const rows = [land({ sid: 'a', test_marked: 1, distinct_id: 'da', journey_id: 'ja' }), land({ sid: 'b', test_identity: 1, distinct_id: 'db', journey_id: 'jb' }), land({ sid: 'c', scanner: 1, distinct_id: 'dc', journey_id: 'jc' }),
    land({ sid: 'd', distinct_id: 'dd', journey_id: 'cw-verify-1' }), land({ sid: 'e', distinct_id: 'de', journey_id: 'jint' }), land({ sid: 'f', distinct_id: 'dok', journey_id: 'jok' })];
  const [r] = attributePosts([post()], rows, [ev('irr_checkout_started', { sid: 'a', distinct_id: 'da', journey_id: 'ja' }), ev('irr_checkout_started', { sid: 'f', distinct_id: 'dok', journey_id: 'jok' })],
    { now: NOW, internalJourneys: new Set(['jint']) });
  assert.equal(r.clicks, 1);
  assert.deepEqual(r.excluded_landing_sessions, { test_marker: 2, scanner: 1, internal_journey: 2 });
  assert.equal(r.checkout_starts, 1); // the excluded session's checkout never counts
});

test('browser that shares an internal journey is internal everywhere', () => {
  const rows = [land({ sid: 'x', distinct_id: 'staff', journey_id: 'cw-verify-9' }), land({ sid: 'y', distinct_id: 'staff', journey_id: null })];
  const [r] = attributePosts([post()], rows, [], { now: NOW });
  assert.equal(r.clicks, 0);
  assert.equal(r.excluded_landing_sessions.internal_journey, 2);
});

test('event-level exclusion: a test-marked downstream event on a clean session is dropped', () => {
  const [r] = attributePosts([post()], [land()], [ev('irr_sample_page_viewed', { test_marked: 1 })], { now: NOW });
  assert.equal(r.clicks, 1);
  assert.equal(r.sample_views, 0);
});

test('untagged, unpublished or failed-query rows get null numbers and no join method', () => {
  const cases = [
    [post({ utm_campaign: null, utm_content: null }), {}],
    [post({ governed_state: 'scheduled', published_at: '2026-12-01T00:00:00Z' }), {}],
    [post({ governed_state: 'legacy_unreviewed', published_at: '2026-12-01T00:00:00Z' }), {}],
    [post(), { queryOk: false }],
  ];
  for (const [p, o] of cases) {
    const [r] = attributePosts([p], [land()], [ev('irr_sample_page_viewed')], { now: NOW, ...o });
    assert.equal(r.clicks, null); assert.equal(r.purchases, null); assert.equal(r.qualified_events, null);
    assert.equal(r.join_method, null);
    assert.equal(r.confidence, 'insufficient_evidence');
    assert.ok(r.notes.length > 10);
  }
});

test('confidence ladder', () => {
  assert.equal(classifyConfidence({ tagged: true, queryOk: true, notYetPublished: false, landingSessions: 3 }).confidence, 'high');
  assert.equal(classifyConfidence({ tagged: true, queryOk: true, notYetPublished: false, landingSessions: 0 }).confidence, 'medium');
  assert.equal(classifyConfidence({ tagged: false, queryOk: true, notYetPublished: false, landingSessions: 9 }).confidence, 'insufficient_evidence');
});

test('exclusionReason precedence: test marker first', () => {
  assert.equal(exclusionReason(land({ test_marked: 1, scanner: 1 }), new Set(), new Set()), 'test_marker');
  assert.equal(exclusionReason(land(), new Set(), new Set()), null);
});

test('queries carry the posthog-conversion-monitor exclusion basis and exact UTM predicate', () => {
  assert.match(LANDING_QUERY, /controlled_test = true OR properties\.test_run = true/);
  assert.match(LANDING_QUERY, /session_replay_events/);
  assert.match(LANDING_QUERY, /active_milliseconds <= 10000/);
  assert.match(LANDING_QUERY, /utm_medium = 'organic_social'/);
  const dq = buildDownstreamQuery([{ sid: 's1', journey_id: 'j1' }, { sid: "x'; drop", journey_id: null }]);
  assert.match(dq, /controlled_test = true OR properties\.test_run = true/);
  assert.match(dq, /'s1'/); assert.match(dq, /'j1'/);
  assert.doesNotMatch(dq, /drop/); // unsafe ids never reach the query
  assert.equal(buildDownstreamQuery([]), null);
});

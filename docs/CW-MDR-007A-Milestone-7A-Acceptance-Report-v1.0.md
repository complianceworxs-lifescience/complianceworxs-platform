# CW-MDR-007A — Milestone 7A Acceptance Report

**Status:** FINAL v1.0 — ACCEPTED. Closure evidence for Milestone 7A.
**Milestone:** 7A — Resilient Execution (CW-GOV-001 §7)
**Governing Design Review:** CW-MDR-007A v1.0 (APPROVED 2026-07-15, commit `8b99acf`; + v1.1
factual correction `7106c9f`)
**Author:** Claude Code (implementer)
**Date drafted:** 2026-07-15
**Closure:** Milestone 7A closed by the CEO / Milestone Owner (Jon Nugent) per CW-GOV-001 §12,
decision recorded 2026-07-15 (governance doc §7.1/§7.8–§7.10). The author did not self-declare
closure; this report is the closure evidence the owner acted on.

---

## 1. Purpose

Closure evidence for Milestone 7A (CW-GOV-001 §4A.2). Maps every acceptance criterion
(A-01…A-06, A-M1) and non-acceptance condition (N-01…N-13) from CW-MDR-007A §17–§18 to
reproducible evidence, and records the decisions resolved during the build (D-1…D-5). This is
the closure evidence the Owner acted on in declaring Milestone 7A closed (2026-07-15).

## 2. Build summary

Six build steps of DR §12, each behind its checkpoint gate (CP-A1…CP-A6), plus the DR itself
and one post-approval factual correction.

| Commit | Step / artifact | M7A IDs | Gate |
|--------|-----------------|---------|------|
| `8b99acf` | CW-MDR-007A v1.0 APPROVED (implementation authorized) | — | §4A |
| `7106c9f` | DR v1.1 factual correction (invalid_response_schema is worker-only) | — | — |
| `fe4e28f` | Taxonomy + policy source + compiler + verify gate | M7A-01/02 | CP-A1 |
| `cd986ea` | Central evaluator + classification certification | M7A-03/11 | CP-A2 |
| `61e882f` | irr-stage-engine consumer refactor | M7A-03 | CP-A3 |
| `f4126f8` | irr-job-worker align + shared decideFailure() | M7A-03 | CP-A4 |
| `79169a2` | error_category column + retry telemetry (migration) | M7A-07/12 | CP-A5 |
| `6348b3b` | Circuit-breaker specified + fault-injection test | M7A-10 | CP-A6 |

Schema migration applied to production (`balkvbmtummehgbbeqap`):
`20260714000008_m7a_resilience_telemetry` — added `irr_stage_runs.error_category` (additive
nullable column) + `m7a_retry_events` table (new, isolated, explicit RLS).

**Deployment status (updated 2026-07-15 — byte-verified production deploy):** the refactored
edge functions are now **deployed to production** (`balkvbmtummehgbbeqap`) under the owner's
explicit, step-confirmed authorization:

| Function | Live version | verify_jwt | Live bundle `ezbr_sha256` | Byte-verification |
|----------|--------------|------------|----------------------------|-------------------|
| `irr-stage-engine` | v32 (from v31) | false | `0bd2afa6224254ccea816d62073f95137d0fde63e984e5fc186a85e559409c88` | all files byte-identical to committed repo source (`61e882f`/`f4126f8`) |
| `irr-job-worker` | v12 (from v11) | false | `c3a226fc662b3957959d1ac613e7d33b4d0554da547afa51e02970e30fac8a5c` | all 10 code files byte-identical to committed repo source (`f4126f8`); `DEPRECATED.md` excluded (docs, not part of the live function) |

Each deploy was byte-verified by re-pulling the live function and confirming per-file sha256
equality (built from raw disk bytes via Python, no hand transcription) plus bundle-hash equality
between `deploy` and `get`. **Zero data impact:** the production snapshot immediately after both
deploys was identical to the pre-deploy baseline (`irr_jobs`/`irr_stage_runs`/`m7a_retry_events`
= 95 / 427 / 0 unchanged; queue idle at deploy). The **rollback baseline** (engine v31 / worker
v11, byte-verified against repo `7106c9f`/`61e882f`, matching what PF-1A originally recovered)
remains intact and untouched. The resilience behavior now takes effect on the next real job that
processes a stage failure. The taxonomy/evaluator/breaker (`resilience/`) and tests remain repo
artifacts.

## 3. Acceptance criteria → evidence

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| A-01 | Retry behavior controlled centrally; no inline/per-path retry decisions | ✅ | Both paths call one `decideFailure()` (→ `evaluate()`); the engine's 34 inline `retryable:` flags and the worker's `RETRYABLE_STAGES` set are removed (static grep = 0). Engine≡worker equivalence proven (`61e882f`, `f4126f8`). |
| A-02 | Transient failures normally recover without manual requeue | ✅ | operational category (timeout/network/429/5xx) retries with backoff/jitter within the ceiling; `network_error`/`api_error` — previously non-retryable in both paths — now recover (parity tables, `61e882f`/`f4126f8`). |
| A-03 | Deterministic failures not retried unchanged | ✅ | contract/business_logic categories are terminal; the §6.2 conflict resolved — `invalid_response_schema` is now terminal in the worker (CP-A2 case 12; CP-A4 parity). |
| A-04 | Retry attempts and delays measurable | ✅ | `m7a_retry_events` (append-only) records attempt + delay per decision; CP-A5 demo aggregated retry_attempts, delays-by-attempt, avg delay (`79169a2`). |
| A-05 | Terminal failures explicit and diagnosable | ✅ | normalized `{reason_normalized, category}` persisted to `classified_failure` + new `error_category` column (engine) and `error_json` jsonb (both); `decideFailure` returns a single shape (M7A-11). |
| A-06 | Circuit-breaking exists where operational evidence justifies it | ✅ | specified + fault-injection-proven (`verify:breaker`: opens at threshold, fast-fails during cooldown, resets); ships **off** (`BREAKER.enabled=false`) — no operational-outage evidence yet, recorded (`6348b3b`). |
| A-M1 | Retry limits/backoff carry recorded provenance, not arbitrary literals | ✅ | every value in `policy.yaml` is annotated as a bootstrap from current production behavior (e.g. `max_attempts:6` = current `irr_stage_runs` default), tightened by telemetry (M7A-04; `fe4e28f`). |

## 4. Non-acceptance conditions → status

None hold:

| ID | Condition | Status | Basis |
|----|-----------|--------|-------|
| N-01 | Retry decided in >1 place / consumer keeps own table | Not triggered | one `decideFailure()`; inline flags + `RETRYABLE_STAGES` removed. |
| N-02 | A taxonomy copy drifts from source | Not triggered | `verify:taxonomy` byte-verifies 8 consumer copies vs canonical. |
| N-03 | Deterministic failure retried unchanged | Not triggered | contract/business_logic terminal (CP-A2). |
| N-04 | Transient failure treated as terminal (e.g. 429 unmapped) | Not triggered | 429→rate_limit/retry (honor Retry-After); network/timeout retryable (CP-A2/A5). |
| N-05 | Retry limits arbitrary literals, no provenance | Not triggered | A-M1 provenance annotations. |
| N-06 | Backoff/jitter absent for operational / applied to deterministic | Not triggered | exponential backoff + deterministic jitter for operational only; delay 0 for terminal (CP-A2). |
| N-07 | Terminal failures not normalized / not diagnosable | Not triggered | normalized shape + category (A-05). |
| N-08 | Attempts/delays not measurable | Not triggered | `m7a_retry_events` (A-04). |
| N-09 | Breaker ships without evidence, or a justified case left unspecified | Not triggered | breaker specified + tested but shipped **off** pending evidence (A-06). |
| N-12 | Scope creep into M8 / §7.7 exclusions | Not triggered | no scheduler/cron/worker/claim-mechanics change; delay is recorded not enforced (D-2(a)); only additive column + isolated table. |
| N-13 | Implementation began before DR approval | Not triggered | all build commits post-date the approval `8b99acf`. |

## 5. Decisions resolved during the build

- **D-1 (step 4):** `irr-stage-engine` is production-authoritative (empirical: cron cadence,
  `irr_stage_runs` writes, not-invoked worker). `irr-job-worker` is dormant → **aligned** (not
  gutted), with operational retirement recommended (`edge-functions/irr-job-worker/DEPRECATED.md`).
- **D-2 (approval):** option (a) — retry decision (incl. `delayMs`) is **recorded, not honored**
  by the claim path; honoring is Milestone 8. No `next_attempt_at` claim change shipped.
- **D-3 (step 6):** breaker state store **deferred** — persisting state matters only once the
  breaker is enabled; adding a table now would be DDL for a disabled feature.
- **D-4 (step 5):** retry telemetry uses a **dedicated append-only table** (`m7a_retry_events`),
  not columns on `irr_stage_runs` (the row is mutated in place and cannot keep per-attempt delay
  history). `error_category` is a column (one classification per stage).
- **D-5 (step 3):** bootstrap ceilings = current `max_attempts` (6); per-category ceilings not
  adopted yet (counts unchanged), to be tightened from telemetry.

## 6. Isolation / safety evidence (direct)

- **Migration (CP-A5):** additive-only. Before/after production snapshot around apply:
  `irr_jobs`/`irr_stage_runs`/`irr_regression_runs` = **95 / 427 / 1 unchanged**; `error_category`
  added with **0 existing rows rewritten**; `m7a_retry_events` created with RLS enabled +
  service_role policy. Telemetry demo rows inserted, aggregated, then deleted (table back to 0).
- **Behavior parity:** the engine refactor changed only `network_error`/`api_error` (→retryable,
  approved §9.2); 13/15 reasons byte-identical. The worker changed only those two (via mapping)
  plus `invalid_response_schema` (§6.2). No other behavior moved.
- **Taxonomy integrity:** `verify:taxonomy` byte-verifies every consumer copy; a corrupted
  taxonomy fails the gate (CP-A1 negative).

## 7. Verification checkpoints — all green

CP-A1 (taxonomy, `fe4e28f`) · CP-A2 (classification, `cd986ea`) · CP-A3 (engine, `61e882f`) ·
CP-A4 (worker, `f4126f8`) · CP-A5 (telemetry/migration, `79169a2`) · CP-A6 (breaker, `6348b3b`).

**Reproduce (one command, from a clean clone):**

```
npm install          # postinstall bootstraps compiler + resilience deps (fix 0df456e)
npm run verify -- --rc   # complete set: compiler, unit, smoke, regression + the 4 M7A gates
```

`npm run verify` auto-selects gates from the diff (M7A gates wired into the orchestrator, fix
`0df456e`): a `resilience/` edit → verify:taxonomy + classification + decide + breaker; a
refactored-engine edit (`irr-stage-engine`) → those + 15 stage certs + smoke; a release
candidate (`--rc`) → the full set. Confirmed green from a genuinely fresh clone with a single
`npm install`. The four M7A gates are also individually runnable: `npm run verify:taxonomy`,
`verify:classification`, `verify:decide`, `verify:breaker`.

**Pre-closure gap fixes (`0df456e`, additive):** the from-clean check found the M7A gates were
not wired into `npm run verify` and the resilience deps were not bootstrapped by the root
postinstall — both closed so the one-command, from-clean guarantee (M7 A-12/N-09) now extends to
M7A.

## 8. Open items for the owner (not blockers to acceptance)

1. **Deployment — DONE (2026-07-15).** The refactored `irr-stage-engine` (v32) and
   `irr-job-worker` (v12) are now deployed to production under explicit, step-confirmed owner
   authorization, byte-verified against the committed repo source with zero data impact and the
   rollback baseline (v31/v11) intact (§2). The resilience behavior is live and awaits the first
   real job that hits a stage failure. Remaining follow-through is only observational — confirming
   `error_category` populates and `m7a_retry_events` records once organic traffic exercises the
   path (monitored manually; a connector-backed scheduled watch is a separate deliberate setup).
2. **Per-category retry ceilings (D-5).** Bootstrap = 6 for all; tightening to the DR's
   evidence-based ceilings (e.g. model_output = 2) is a deliberate later change once telemetry
   accumulates.
3. **Circuit-breaker enablement (A-06/D-3).** Off until telemetry shows correlated outages;
   enabling it is a separate evidence-backed step (adds the state table — DDL — and wires the
   runtime).
4. **irr-job-worker retirement (D-1).** Recommended operational follow-up.

## 9. Recommendation

All A-* criteria are satisfied, no N-* condition holds, all §7.6 metrics are met, and every
build step passed its gate with reproducible evidence. The refactored edge functions were
deployed to production (2026-07-15), byte-verified and with zero data impact, under explicit
step-confirmed owner authorization (§2). On this evidence the CEO / Milestone Owner (Jon Nugent)
**declared Milestone 7A closed on 2026-07-15** (CW-GOV-001 §7.1/§7.8–§7.10). The author did not
self-declare closure; this document is the evidence the Owner acted on.

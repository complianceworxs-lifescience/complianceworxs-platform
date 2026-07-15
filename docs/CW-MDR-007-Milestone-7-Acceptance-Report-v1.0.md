# CW-MDR-007 — Milestone 7 Acceptance Report

**Status:** FINAL v1.0 — ACCEPTED. Closure evidence for Milestone 7.
**Milestone:** 7 — Developer Productivity and Verification (CW-GOV-001 §6)
**Governing Design Review:** CW-MDR-007 v1.0 (APPROVED 2026-07-15, commit `e3a42cf`)
**Author:** Claude Code (implementer)
**Date drafted:** 2026-07-15
**Closure:** Milestone 7 closed by the CEO / Milestone Owner (Jon Nugent) per CW-GOV-001
§12, decision recorded 2026-07-15 (governance doc §6.1/§6.9–§6.11). The author did not
self-declare closure; this report is the closure evidence the owner acted on.

---

## 1. Purpose

This report presents the closure evidence for Milestone 7 (CW-GOV-001 §4A.2, "Acceptance
Report produced at closure"). It maps every acceptance criterion (A-01…A-14, A-M1…A-M6)
and every non-acceptance condition (N-01…N-13) from CW-MDR-007 §18–§19 to concrete,
reproducible evidence, and records the two deviations encountered and how they were
resolved. It does not assert that Milestone 7 is closed.

## 2. Build summary (append-only history since DR approval)

Implementation was performed in the six build steps of DR §12, each behind its own
checkpoint gate (CP-1…CP-6), plus one follow-up fix found by an independent post-build
check.

| Commit | Step | Scope | Gate |
|--------|------|-------|------|
| `4878c8f` | 1 | Compiler verification (M7-02) + D-4 `contract.yaml` relocation | CP-1 |
| `f30fbd0` | 2 | Fixture + test generation (M7-05/06/07/08) | CP-2 |
| `facc3d8` | 3 | Stage certification libraries + canonical cases (M7-03/04) | CP-3 |
| `1be589a` | 4 | Smoke / runtime-stage certification (M7-09/14) | CP-4 |
| `30666e7` | 5 | Regression corpus + runner + isolation migration (M7-10/11) | CP-5 |
| `4258cfa` | 6 | Verify orchestrator + gate policy + reporting (M7-01/12/13) | CP-6 |
| `99185e6` | 6-fix | Bootstrap compiler deps on install (clean-checkout fix, M7-12/N-09) | CP-6 (re-run from clean) |

Schema migration applied to production (`balkvbmtummehgbbeqap`):
`20260714000007_m7_regression_isolation` — created `m7_regression_runs` and
`m7_regression_case_results` (new isolated tables; explicit RLS + policies).

## 3. Acceptance criteria → evidence

**Scope acceptance (§6.3 → M7-IDs):**

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| A-01 | Gate policy + `npm run verify` selects gates from diff | ✅ | `detect-changes.js`; CP-6 selection verified across simulated diffs: contract→compiler; stage case→that stage+smoke; runtime/migration→regression; docs→baseline; stage engine→all 15 stages+smoke (`4258cfa`). |
| A-02 | `verify:compiler` regenerates 3 artifacts byte-identical; corrupt contract fails nonzero | ✅ | `compiler/verify.js`; clean → exit 0 (3/3 byte-identical); corrupted contract → exit 1. `contract-generated.ts` sha256 `b9658110…` == deployed `irr-stage-engine/contract-generated.ts` (`4878c8f`). |
| A-03 | Reusable stage-certification library certifies a stage without a full pipeline run | ✅ | `tests/stage-certification/_lib/certify-core.mjs`; `verify:stage <id>` runs per-stage with no model call (`facc3d8`). |
| A-04 | 9 model stages 5–10 cases; 6 deterministic stages justified fewer | ✅ | Model stages 4–11,13 carry 5–7 authored cases each; deterministic 1–3,12,14,15 carry a minimal structural set (justified per §5.1). CP-3 all 15 certify (`facc3d8`). |
| A-05 | Valid fixtures per field pass validation | ✅ | `tests/fixtures/generated/*.valid.json`; generated validator tests pass (40/40) (`f30fbd0`). |
| A-06 | Invalid fixtures per field fail with expected reason | ✅ | `*.invalid.json`; validator tests assert each throws (40/40) (`f30fbd0`). |
| A-07 | Generated validator tests pass valid / fail invalid | ✅ | `tests/generated/validator.test.mjs`; `# tests 40 / # pass 40 / # fail 0`. |
| A-08 | Generated prompt-fragment tests match contract | ✅ | `tests/generated/prompt-fragment.test.mjs` (part of the 40). |
| A-09 | Repeatable smoke: one complete execution, re-runnable | ✅ | `verify:smoke` runs each case; suite executed twice with identical result shape (`1be589a`). |
| A-10 | Corpus per-case: case_id, case_name, payload, scenario, expected terminal, version, immutable inputs | ✅ | `tests/regression-corpus/`: each case has `case_id`, `case_name`, `scenario`, `stage`, `expected` (terminal status+reason), `payload`; `corpus.version` + `index.json` (sha256 per case + `corpus_hash`). Field names match the DR (`case_id` / `case_name`); `expected` retained deliberately (see §8). |
| A-11 | Regression run: run_id, per-case, stage+error, aggregate, isolated | ✅ | `run-regression.js` → run_id + 5 per-case rows + aggregate; direct DB proof of isolation (§6 below) (`30666e7`). |
| A-12 | `npm run verify` performs §6.5 steps 1–6 in one command | ✅ | `verification/verify.js`; single command runs compiler+unit+stage+smoke(+regression)+report. Confirmed from a genuinely clean clone after the `99185e6` fix. |
| A-13 | Single unambiguous, concise report (human + JSON) | ✅ | `report.js`; `--json` machine form + human summary, one OVERALL pass/fail (`4258cfa`). |
| A-14 | Modified stage certified end-to-end via runtime (smoke) without a full production run | ✅ | `verify:smoke` executes the real runtime offline with an isolated run_id; no production job mutation (§6 below) (`1be589a`). |

**Success-metric acceptance (§6.7):**

| ID | Metric | Status | Evidence |
|----|--------|--------|----------|
| A-M1 | Routine stage change verifies < 2 min (excl. external latency) | ✅ | **Measured 936 ms** from a clean clone (budget 120 000 ms); no external-provider latency (smoke/regression use the offline adapter). Full RC path 4225 ms. |
| A-M2 | One complete smoke execution is repeatable | ✅ | Smoke suite run twice, identical result shape (`1be589a`). |
| A-M3 | Regression run isolated and attributable | ✅ | run_id `579d0cb2…` + `corpus_hash 29a33455…` persisted to `m7_regression_runs` (`30666e7`). |
| A-M4 | Regression membership not from shared production-table time windows | ✅ | `isolation.js` membership = corpus index case_id set (content-addressed); no DB/time-window input. |
| A-M5 | Unambiguous report | ✅ | A-13. |
| A-M6 | Release candidate verifiable without manual reconstruction | ✅ | After `99185e6`, single `npm install` (postinstall bootstraps compiler dep) → `npm run verify --rc` PASS from a fresh clone. |

## 4. Non-acceptance conditions → status

None of the following hold (each is demonstrably avoided):

| ID | Condition | Status | Basis |
|----|-----------|--------|-------|
| N-01 | Compiler false-green / fails to fail | Not triggered | Byte-exact compare; corrupt contract → exit 1 (A-02). |
| N-02 | Fixtures/tests hand-edited or nondeterministic | Not triggered | Generated from `contract.yaml`; two generations byte-identical (CP-2). |
| N-03 | Stage "certifies" on bare model response / skips stages | Not triggered | Non-object output rejected; all 15 stages certified; reconciliation enforced (`certify-core.mjs`). |
| N-04 | <5 cases unjustified / model-derived expecteds | Not triggered | ≥5 authored cases per model stage; authored `expect`; min-count guard fires on <5 (CP-3). |
| N-05 | Smoke mutates production tables / needs full prod run | Not triggered | Zero network egress; no DB import; irr_* unchanged before/after (§6). |
| N-06 | Corpus mutable in place / case_id reused | Not triggered | Immutability gate fails on in-place edit without `--reindex` (demonstrated). |
| N-07 | Regression membership via prod time window / touches prod jobs | Not triggered | Corpus-index membership; irr_* untouched by a persisted run (§6). |
| N-08 | Run lacks run_id / not tied to corpus version | Not triggered | run_id + corpus_hash on every run and persisted row. |
| N-09 | `npm run verify` can't run from clean checkout | Not triggered (after fix) | Found in independent check (root `npm install` missed the compiler dep); fixed in `99185e6`; re-verified from a fresh clone with zero manual steps. |
| N-10 | Ambiguous / non-machine-readable report | Not triggered | Single OVERALL + `--json` (A-13). |
| N-11 | Routine change can't verify < 2 min | Not triggered | Measured 936 ms (A-M1). |
| N-12 | §6.8-excluded scope introduced | Not triggered | No retry/resilience/scheduler/cron/worker/parallelization work; changes confined to the verification toolchain + two new isolated tables. |
| N-13 | Implementation began before DR approval | Not triggered | All build commits (`4878c8f`…`99185e6`) post-date the approval commit `e3a42cf`. |

## 5. Success metrics (CW-GOV-001 §6.7)

Milestone 7 §6.7 closes when all six hold; each is met:

1. Routine stage changes verify under two minutes — **936 ms measured**.
2. One complete smoke execution is repeatable — **yes** (twice, same shape).
3. A regression run is isolated and attributable — **yes** (run_id + corpus_hash; isolated tables).
4. Shared production-table time windows no longer define regression membership — **yes** (corpus-index membership).
5. The verification command produces an unambiguous report — **yes** (single OVERALL + JSON).
6. Release candidates verify without manual reconstruction — **yes** (single `npm install` from clean).

## 6. Isolation evidence (direct, not asserted)

**Smoke (CP-4 / R-04 / N-05):** the runtime is value-in/value-out, imports only
`node:crypto` + local siblings; the runner scans the executed logic for DB markers (none),
runs behind a network-egress guard (0 calls), and the executed logic sha256 matches the
deployed bytes exactly. Direct production check around a fresh smoke run:
`irr_jobs 94 / irr_stage_runs 412` unchanged, 0 new rows in 10 min.

**Regression (CP-5 / N-07):** the migration creates only `m7_*` tables (static scan: no
ALTER/DROP against `irr_*`). Applied to production; both tables exist with RLS enabled +
explicit `service_role` policies. A persisted run wrote 1 run row + 5 case rows to the m7
tables while `irr_jobs 94 / irr_stage_runs 412 / irr_regression_runs 1` stayed unchanged.
Immutability gate demonstrated to fail on an in-place case edit.

## 7. Independent post-build verification (2026-07-15)

1. **Clean-checkout run:** fresh clone → single `npm install` → `npm run verify` →
   OVERALL PASS in 936 ms, **zero manual steps** (after `99185e6`).
2. **DB state re-check:** `irr_jobs 94 / irr_stage_runs 412 / irr_regression_runs 1`
   unchanged; `m7_regression_runs 1 / m7_regression_case_results 5` (1 distinct run_id —
   the single step-5 demo run); orchestrator regression runs left no rows (non-persisting
   by default).
3. **Commit history:** exactly the six build commits since approval `e3a42cf`, in order,
   plus the one explicitly-labeled `99185e6` bootstrap fix — append-only, nothing
   unexpected.

## 8. Deviations & notes

- **D-4 (resolved):** `contract.yaml` was relocated into `compiler/` so `compile.js`
  resolves it; recorded in the DR and applied in step 1 (`4878c8f`).
- **Clean-checkout gap (resolved):** an independent check found `npm run verify` failed
  from a fresh clone because `js-yaml` (in `compiler/package.json`) is not installed by a
  root `npm install`. Fixed with a root `postinstall` (`99185e6`); re-verified from clean.
- **A-10 field naming (resolved):** the corpus field `name` was renamed to `case_name` to
  match the DR (`case_id` / `case_name`) exactly. `expected` was deliberately **not**
  renamed to `expected_terminal_result` — that would newly conflict with CW-EXEC-001's
  "terminal state" vocabulary while fixing a DR-text mismatch. The corpus was bumped
  `1.0.0` → `1.1.0` to carry the renamed content, preserving the content-addressing
  guarantee that one version label denotes one fixed byte set: version **1.1.0** is the
  current corpus (`corpus_hash f44bef39…`), and version **1.0.0** is the superseded
  pre-rename corpus (`corpus_hash 29a33455…`), which the one-off step-5 isolation-demo run
  persisted in `m7_regression_runs` is attributed to. Each version maps to exactly one
  hash — no divergence remains. CP-5 re-verified green under 1.1.0.
- **Scope discipline:** each step was committed within its stated scope; no §6.8-excluded
  work was introduced.

## 9. Closure

All A-* criteria are satisfied, no N-* condition holds, and all six §6.7 metrics are met,
each with reproducible evidence; the A-10 field naming was resolved and the corpus
version/hash uniqueness closed. The Milestone Owner reviewed this report — including an
independent re-query of the production isolation numbers directly against Supabase — and
**recorded the closure of Milestone 7 on 2026-07-15** per CW-GOV-001 §12. The governance
doc §6.1 is set to **Closed** with closure date, authority, and evidence in §6.9–§6.11.

---

### Reproduce the acceptance evidence

```
# from a clean clone:
npm install                 # postinstall bootstraps compiler dep
npm run verify -- --diff "tests/stage-certification/claim_status/cases/01-valid-exact.json"   # routine stage change (<2 min)
npm run verify -- --rc      # full release-candidate path
npm run verify:compiler     # A-02  (corrupt: node compiler/verify.js --contract <bad> -> nonzero)
npm run test:generated      # A-05..A-08 (40/40)
npm run verify:stage -- claim_status   # A-03/04
npm run verify:smoke        # A-09/14/M2
npm run verify:regression   # A-11/M3/M4  (--sql to persist to the isolated m7 tables)
```

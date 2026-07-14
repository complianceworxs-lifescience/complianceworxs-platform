# Milestone 7 Design Review — Developer Productivity and Verification

**Document ID:** CW-MDR-007
**Version:** 0.1.0 — **DRAFT (for review; NOT approved; implementation not authorized)**
**Milestone:** 7 — Developer Productivity and Verification (CW-GOV-001 §6)
**Gate:** CW-GOV-001 §4A — implementation may not begin until this Design Review is approved.
**Author:** Platform recovery/engineering
**Governing docs:** CW-GOV-001 (authority for scope), CW-EXEC-001 (how workflows are specified), CW-ARCH-001 (permanent architecture).

> Note: No prior Design Review existed in the repository; this is the first draft. It
> is scoped to the **entire** CW-GOV-001 §6 Milestone 7 definition (not compiler
> verification alone) and is kept as a single Design Review mapped to the single
> milestone (no "Phase 1" split).

---

## 1. Purpose

Define, before any code is written, the concrete design for Milestone 7: what files and
components will be created, who owns them, in what order they are built, migrated, and
rolled out, and exactly how each CW-GOV-001 §6 requirement will be verified and accepted.
This satisfies CW-GOV-001 §4A.1 (planned files/components; migration steps; risks;
acceptance tests mapped to the milestone's success metrics).

## 2. Governing References & Precedence

- **CW-GOV-001 §6** — the authoritative scope, verification gates, required command,
  regression-corpus requirements, and success metrics for Milestone 7. This document
  maps 1:1 to it.
- **CW-EXEC-001** — the Execution Specification standard; the verification tooling
  reads the contract registry and stage/validation model defined there. This DR does
  not redefine any workflow; it builds tooling that *checks* conformance to it.
- **CW-ARCH-001 §3.3, §7, §9.3** — contract-first invariant. Verification tooling is a
  *consumer* of the contract registry; it must not become a second source of truth.
- **Precedence:** for scope, CW-GOV-001 controls (its §6). This DR neither expands nor
  contracts §6; §6.8 exclusions are honored verbatim (§6 of this document).

## 3. Milestone Mapping (traceability spine)

Every §6 sub-requirement is assigned an ID here and carried through Implementation
Architecture (§11), Acceptance (§18), Tests (§20), Non-Acceptance (§19), and Risks (§21).

| ID | CW-GOV-001 §6 requirement | Source |
|----|---------------------------|--------|
| M7-01 | Verification-gate policy | §6.3, §6.4 |
| M7-02 | Compiler verification (generated artifacts agree with contract) | §6.3, §6.4 |
| M7-03 | Stage certification libraries | §6.3, §6.4 |
| M7-04 | 5–10 canonical cases per stage where justified | §6.3 |
| M7-05 | Compiler-generated valid fixtures | §6.3 |
| M7-06 | Compiler-generated invalid fixtures | §6.3 |
| M7-07 | Compiler-generated validator tests | §6.3 |
| M7-08 | Compiler-generated prompt-fragment tests | §6.3 |
| M7-09 | Repeatable smoke-test automation | §6.3, §6.4 |
| M7-10 | Canonical regression corpus (case_id, name, payload, scenario, expected terminal result, corpus version, immutability) | §6.3, §6.6 |
| M7-11 | Regression run IDs, isolated batches, pass/fail, isolation from unrelated production jobs | §6.3, §6.6 |
| M7-12 | One-command local verification (`npm run verify`) | §6.3, §6.5 |
| M7-13 | Concise verification reports | §6.3, §6.5 |
| M7-14 | Runtime-stage certification (certify a modified stage end-to-end without a full production run) | §6.2, §6.4 (Stage certification + Smoke) |

## 4. Objective (CW-GOV-001 §6.2)

Make routine development changes fast, repeatable, isolated, and safe to verify **without
using full production regression runs as the primary diagnostic mechanism**. A developer
editing a stage prompt, a validator, or the contract must get a trustworthy pass/fail
answer locally in minutes.

## 5. In-Scope Components (CW-GOV-001 §6.3, full)

All of §6.3 is in scope (mapped M7-01…M7-13) plus runtime-stage certification (M7-14):
verification-gate policy; compiler verification; stage certification libraries; 5–10
canonical cases per stage; compiler-generated valid/invalid fixtures; compiler-generated
validator tests; compiler-generated prompt-fragment tests; repeatable smoke-test
automation; canonical regression corpus; permanent regression case IDs; immutable/
controlled-version case inputs; regression run IDs; isolated regression batches;
pass/fail reporting; one-command local verification; concise verification reports.

## 6. Explicit Exclusions (CW-GOV-001 §6.8, verbatim)

Out of scope and must not be built under this milestone: retry-policy redesign;
centralized operational resilience; scheduler redesign; cron removal; worker-owned
continuous execution; parallel execution optimization. (These belong to Milestones 7A/8.)

## 7. Verification-Gate Policy (M7-01; CW-GOV-001 §6.4)

| Gate | Trigger | Runs | Purpose |
|------|---------|------|---------|
| **Compiler verification** | Edit to `contract.yaml` or schema | `verify:compiler` | Prove generated artifacts (`contract-generated.ts`, `contract-schema.json`, `CONTRACT.md`) regenerate identically from the contract |
| **Stage certification** | Edit to a stage's code or prompt | `verify:stage <id>` | Prove the modified stage against its canonical cases (structural + validator level) |
| **Smoke test** | Stage edit after certification passes | `verify:smoke` | Prove one complete end-to-end execution |
| **Full regression** | Shared-infra change or release candidate | `verify:regression` | Prove release-level compatibility across the corpus |

Policy: the narrowest gate that covers the change must pass before merge; `npm run verify`
(M7-12) auto-selects gates from what changed.

## 8. Required Command — `npm run verify` (M7-12/13; CW-GOV-001 §6.5)

`npm run verify` performs, as applicable: (1) compile contracts; (2) verify generated
artifacts; (3) run unit tests; (4) identify modified stages; (5) run relevant stage
certification; (6) produce a concise report. Sub-scripts (`verify:compiler`,
`verify:stage`, `verify:smoke`, `verify:regression`) are individually runnable.

## 9. Canonical Regression Corpus (M7-10/11; CW-GOV-001 §6.6)

Each corpus case provides: stable `case_id`; human-readable `case_name`; controlled input
payload; scenario classification; expected terminal result; corpus version; and
immutability (inputs are content-addressed — a changed input is a new `case_id@version`,
never a silent mutation). Each regression run provides: unique `run_id`; case-level
result; stage + error for failures; aggregate pass/fail; and **isolation from unrelated
production jobs** (dedicated run scope; no reliance on shared production-table time
windows to define membership — see §17).

## 10. Component Ownership

| Component area | Owns | Primary paths |
|---|---|---|
| **Contract Compiler** | M7-02, M7-05..08 (verification + fixture/test generation from the contract) | `compiler/` |
| **Stage Engine** | M7-03, M7-04, M7-14 (stage certification libraries, canonical cases, runtime-stage certification) | `edge-functions/irr-stage-engine/`, `tests/stage-certification/` |
| **Runtime** | M7-14 (model-call runtime under certification/smoke) | `edge-functions/runtime/`, `edge-functions/runtime-worker/` |
| **Regression Harness** | M7-09, M7-10, M7-11 (corpus, runner, isolation, run IDs) | `tests/regression-corpus/`, `verification/regression/` |
| **DevEx / Verify Orchestrator** | M7-01, M7-12, M7-13 (gate policy, `npm run verify`, reporting) | `verification/`, `package.json`, `scripts/` |

## 11. Implementation Architecture — repository paths & file-by-file plan

Target layout (new paths marked ⊕; existing marked ✓). Nothing here is created until this
DR is approved.

```
complianceworxs-platform/
├─ package.json                         ⊕ add scripts: verify, verify:compiler,
│                                          verify:stage, verify:smoke, verify:regression
├─ compiler/
│  ├─ compile.js                        ✓ contract compiler (already recovered/verified)
│  ├─ contract.yaml                     ⊕ move/symlink from repo root (fix known layout
│  │                                       mismatch: compile.js reads __dirname/contract.yaml)
│  ├─ verify.js                         ⊕ M7-02: recompile into a temp dir, diff against
│  │                                       committed compiler/generated/*; nonzero on drift
│  ├─ generate-fixtures.js              ⊕ M7-05/06: emit valid + invalid fixtures per field
│  │                                       from contract.yaml into tests/fixtures/generated/
│  ├─ generate-tests.js                 ⊕ M7-07/08: emit validator tests + prompt-fragment
│  │                                       tests from contract.yaml into tests/generated/
│  └─ generated/                        ⊕ committed compiler outputs (contract-generated.ts,
│                                          contract-schema.json, CONTRACT.md) — the diff target
├─ tests/
│  ├─ fixtures/generated/               ⊕ M7-05/06 compiler-generated valid/invalid fixtures
│  ├─ generated/                        ⊕ M7-07/08 compiler-generated validator/prompt tests
│  ├─ stage-certification/
│  │  ├─ <stage_id>/cases/*.json        ⊕ M7-04: 5–10 canonical cases per justified stage
│  │  └─ <stage_id>/certify.js          ⊕ M7-03: per-stage certification library entrypoint
│  └─ regression-corpus/
│     ├─ corpus.version                 ⊕ M7-10 corpus version marker
│     ├─ cases/<case_id>.json           ⊕ M7-10 case: id, name, payload, scenario, expected
│     └─ index.json                     ⊕ manifest (case_id → hash) for immutability check
├─ verification/
│  ├─ verify.js                         ⊕ M7-12: orchestrator (steps 1–6 of §6.5); selects
│  │                                       gates from `git diff` (M7-01)
│  ├─ detect-changes.js                 ⊕ M7-01: map changed paths → gates/stages
│  ├─ smoke/run-smoke.js               ⊕ M7-09/M7-14: one complete execution against a
│  │                                       fixed smoke case; isolated run_id
│  ├─ regression/run-regression.js     ⊕ M7-11: corpus runner; assigns run_id; isolated batch
│  ├─ regression/isolation.js          ⊕ M7-11: run-scoped selection (no shared prod time-window)
│  └─ report.js                         ⊕ M7-13: concise pass/fail report (text + json)
├─ scripts/
│  └─ ci-verify.sh                      ⊕ CI entrypoint wrapping `npm run verify` (advisory
│                                          in M7; enforcement is out of scope per §6 exclusions)
└─ supabase/migrations/
   └─ 2026XXXX_m7_regression_isolation.sql  ⊕ M7-11: regression run/case registry with
                                              run_id + isolation columns (see §13)
```

**Design constraints (from CW-ARCH-001):** the compiler remains the single source of
truth (§9.3); `verify.js` and generators are *consumers* of `contract.yaml` and never
redefine a field. Fixtures/tests are generated artifacts, not hand-authored truth
(mirrors §7's contract-first rule).

## 12. Build Sequence

1. **Compiler verification (M7-02).** `compiler/verify.js` + `compiler/generated/` committed,
   fix the `contract.yaml` layout so `compile.js` resolves it. Gate: `verify:compiler` green.
2. **Fixture + test generation (M7-05..08).** `generate-fixtures.js`, `generate-tests.js`;
   commit generated fixtures/tests. Gate: generated artifacts stable across two runs.
3. **Stage certification libraries + canonical cases (M7-03, M7-04).** Per-stage `certify.js`
   + 5–10 cases per justified stage.
4. **Runtime-stage certification + smoke (M7-14, M7-09).** `run-smoke.js` drives one full
   execution through the runtime for a modified stage.
5. **Regression corpus + runner + isolation (M7-10, M7-11).** Corpus files, `run-regression.js`,
   `isolation.js`, and the isolation migration (§13).
6. **Orchestrator + reporting + gate policy (M7-12, M7-13, M7-01).** `verify.js`,
   `detect-changes.js`, `report.js`, `package.json` scripts.

Each step is independently mergeable behind its own passing gate; later steps depend only
on earlier ones (no forward references).

## 13. Migration Sequence (schema/contract/data changes)

- **Contract changes:** none required. Compiler verification uses the existing
  `contract.yaml`; no field additions/renames.
- **Schema (one migration, M7-11):** `..._m7_regression_isolation.sql` adds a regression
  **run registry** (`run_id` PK, corpus_version, started_at, status, aggregate result) and
  a **case-result** table (run_id FK, case_id, stage, outcome, error) — or extends the
  existing `irr_regression_runs` / `irr_stage_runs` tables with `run_id` + isolation
  columns if reuse is cleaner (decided in implementation, recorded in the migration).
  RLS: enabled, consistent with the `ensure_rls` posture (PF-1B DRIFT-REPORT caveat).
- **Data:** no backfill of production data. Corpus cases are new, versioned, immutable
  inputs stored in-repo (not derived by mutating production rows).
- **Ordering:** the isolation migration lands after the PF-1B migration set (…000006) and
  after the PF-1B RLS-replay decision is taken (dependency, §22).

## 14. Rollout Sequence

1. Land build steps 1–6 (each behind its gate) on a feature branch; open PR to `main`.
2. `npm run verify` runs locally and in CI in **advisory** mode (report-only; CI
   *enforcement* is excluded by §6.8-adjacent scope — this milestone delivers the
   capability, not mandatory CI gating).
3. Smoke + a full regression run on the branch produce a `run_id` report attached to the PR.
4. Merge to `main`. No production runtime behavior changes (tooling only); no edge-function
   redeploy required for M7-01..13. M7-14 exercises the runtime read-only against fixtures/
   a smoke case — no production job mutation.
5. Tag the corpus version; record closure evidence (Acceptance Report per §4A.2).

## 15. Verification Checkpoints (per build step)

- **CP-1 (compiler):** `verify:compiler` reproduces `compiler/generated/*` byte-identical;
  a deliberately corrupted contract fails it.
- **CP-2 (fixtures/tests):** two consecutive generations are byte-identical; generated
  validator tests pass against valid fixtures and fail against invalid fixtures.
- **CP-3 (stage certification):** each justified stage has 5–10 cases; `verify:stage <id>`
  passes for an unmodified stage and fails when a case's expected output is violated.
- **CP-4 (smoke/runtime):** `verify:smoke` completes one full execution with an isolated
  `run_id`, no writes to unrelated production jobs.
- **CP-5 (regression):** `verify:regression` yields a `run_id`, per-case results, aggregate
  pass/fail, and membership defined without a shared production time window.
- **CP-6 (orchestrator):** `npm run verify` selects the correct gates from a simulated
  diff and emits one unambiguous report; a routine stage change verifies in < 2 min
  (excluding external-provider latency).

## 16. Interfaces & Contracts

- **Contract registry:** tooling imports `compiler/generated/contract-generated.ts`
  (validators, prompt fragments, types) and `contract-schema.json` — never re-derives them.
- **Stage engine:** certification invokes the stage's declared inputs→outputs→validation
  from the Execution Specification model (CW-EXEC-001 §11–15); it asserts reconciliation
  (exact coverage, reject duplicates/extras) rather than "model returned something."
- **Runtime:** smoke/runtime-stage certification calls the runtime adapters with fixture
  inputs; assertions are on validated output + terminal state (CW-EXEC-001 §24), not prose.
- **Reporting:** `report.js` emits both a concise human summary and a machine-readable
  JSON (`run_id`, gate, per-item pass/fail) for PR attachment.

## 17. Regression Isolation Design (M7-11 detail)

Membership of a regression run is defined by an explicit `run_id`-scoped set of corpus
`case_id`s — **not** by "rows in a production table within a time window." Runner writes
results tagged with `run_id` to the M7 regression tables (§13), which are separate from
live IRR job tables, so a regression run never contends with or is polluted by unrelated
production jobs. Corpus inputs are content-addressed (`index.json` hash) so a run is
reproducible and attributable to an exact corpus version.

## 18. Acceptance Criteria (one per CW-GOV-001 §6 requirement + §6.7 metrics)

**Scope acceptance (§6.3 → M7-IDs):**
- **A-01 (M7-01):** A documented verification-gate policy exists and `npm run verify`
  demonstrably selects gates from changed paths (compiler edit → compiler gate; stage edit
  → stage+smoke; shared-infra/RC → full regression).
- **A-02 (M7-02):** `verify:compiler` regenerates `contract-generated.ts`,
  `contract-schema.json`, `CONTRACT.md` **byte-identical** to committed; corrupting the
  contract fails the gate nonzero.
- **A-03 (M7-03):** A reusable stage-certification library exists and certifies a stage
  from declared inputs/outputs/validation without a full pipeline run.
- **A-04 (M7-04):** Every justified stage has **5–10** canonical cases; the justification
  for any stage with fewer is recorded.
- **A-05 (M7-05):** Compiler emits **valid** fixtures per contract field; they pass validation.
- **A-06 (M7-06):** Compiler emits **invalid** fixtures per contract field; they fail
  validation with the expected reason.
- **A-07 (M7-07):** Compiler-generated **validator tests** exist and pass against valid /
  fail against invalid fixtures.
- **A-08 (M7-08):** Compiler-generated **prompt-fragment tests** assert each field's prompt
  constraint matches the contract.
- **A-09 (M7-09):** A repeatable smoke test runs **one complete execution** on demand and
  is re-runnable with identical setup.
- **A-10 (M7-10):** The corpus provides, per case, `case_id`, `case_name`, payload, scenario
  classification, expected terminal result, corpus version, and immutable/versioned inputs
  (hash-verified).
- **A-11 (M7-11):** A regression run produces a unique `run_id`, case-level results, stage+
  error on failures, an aggregate pass/fail, and is isolated from unrelated production jobs.
- **A-12 (M7-12):** `npm run verify` performs §6.5 steps 1–6 as applicable in a single command.
- **A-13 (M7-13):** Verification output is a single **unambiguous, concise** report
  (human + JSON).
- **A-14 (M7-14):** A modified stage can be certified end-to-end through the runtime
  (smoke) without triggering or mutating a full production regression run.

**Success-metric acceptance (§6.7):**
- **A-M1:** A routine stage change verifies in **under two minutes**, excluding
  unavoidable external-provider latency (measured on CP-6).
- **A-M2:** One complete smoke execution is **repeatable** (A-09 re-run twice, same result shape).
- **A-M3:** A regression run is **isolated and attributable** (A-11; run_id + corpus hash).
- **A-M4:** Regression membership no longer uses **shared production-table time windows**
  (verified by §17 design: membership is run_id-scoped corpus sets).
- **A-M5:** The verification command produces an **unambiguous report** (A-13).
- **A-M6:** A release candidate can be verified **without manual reconstruction**
  (`verify:regression` from a clean checkout yields the full report).

## 19. Non-Acceptance Conditions

The milestone is **not** accepted — regardless of partial progress — if any of the
following hold (expanded to cover the full scope, not compiler verification alone):

- **N-01 (compiler):** `verify:compiler` passes while the committed `compiler/generated/*`
  differs from a fresh compile (false green), or fails to fail on a corrupted contract.
- **N-02 (fixtures/tests):** Generated fixtures/tests are hand-edited (not regenerated from
  the contract), i.e. the contract-first invariant (CW-ARCH-001 §9.3) is violated; or
  generation is nondeterministic across runs.
- **N-03 (stage certification):** A stage "certifies" on a bare successful model response
  without enforcing declared validation/reconciliation (violates CW-EXEC-001 §12);
  or certification silently skips stages.
- **N-04 (canonical cases):** A justified stage ships with fewer than 5 cases and no
  recorded justification; or case expected-results are derived from current model output
  rather than authored (circular acceptance).
- **N-05 (smoke/runtime, M7-14):** The smoke/runtime path mutates production job/stage
  tables, or cannot run without a full production regression run (defeats §6.2).
- **N-06 (regression corpus):** Case inputs are mutable in place (no version bump / hash
  change), or a `case_id` is reused with different inputs (breaks immutability, M7-10).
- **N-07 (regression isolation):** Run membership is defined by a shared production-table
  time window, or a regression run reads/writes unrelated production jobs (violates §6.6/§6.7 A-M4).
- **N-08 (run attribution):** A regression run lacks a unique `run_id` or cannot be tied to
  an exact corpus version.
- **N-09 (one-command):** `npm run verify` cannot run from a clean checkout, requires manual
  reconstruction, or omits an applicable §6.5 step without justification.
- **N-10 (report):** Output is ambiguous (no clear aggregate pass/fail) or not machine-readable.
- **N-11 (performance):** A routine stage change cannot be verified under two minutes
  excluding external-provider latency (A-M1 unmet) — unless a specific, accepted justification
  is recorded.
- **N-12 (scope creep):** Any §6.8-excluded work (retry policy, resilience, scheduler,
  cron removal, worker-owned execution, parallelization) is introduced under this milestone.
- **N-13 (governance):** Implementation began before this DR was approved (violates §4A), or
  a workflow was changed without an approved Execution Specification (CW-ARCH-001 §9.9).

## 20. Test Plan (acceptance tests mapped to success metrics)

| Test | Verifies | Maps to |
|------|----------|---------|
| T-1 corrupt-contract → `verify:compiler` fails; clean → byte-identical | A-02, N-01 | M7-02 |
| T-2 generate twice → identical; validator tests pass valid / fail invalid | A-05..08, N-02 | M7-05..08 |
| T-3 certify unmodified stage → pass; violate a case → fail | A-03, A-04, N-03/04 | M7-03/04 |
| T-4 smoke run twice → same shape; assert no writes to prod job tables | A-09, A-14, A-M2, N-05 | M7-09/14 |
| T-5 regression run → run_id, per-case, aggregate; membership is corpus-scoped | A-11, A-M3/A-M4, N-06/07/08 | M7-10/11 |
| T-6 `npm run verify` on simulated diffs selects correct gates; < 2 min; one report | A-01, A-12, A-13, A-M1/A-M5/A-M6, N-09/10/11 | M7-01/12/13 |

## 21. Key Risks

Expanded to cover every added component (not compiler verification alone).

- **R-01 Compiler false-green (M7-02).** Diff logic normalizes whitespace/line-endings and
  masks real drift. *Affects:* trust in the whole gate. *Mitigation:* byte-exact compare
  (as used in PF-1A/compiler recovery), plus a corrupt-contract negative test (T-1).
- **R-02 Generated-artifact nondeterminism (M7-05..08).** Map/object ordering or timestamps
  make fixtures/tests differ run-to-run. *Affects:* every downstream gate. *Mitigation:*
  deterministic ordering + no timestamps in generated output; T-2 stability check.
- **R-03 Hollow stage certification (M7-03/04).** Cases assert "ran" not "correct," or
  expected outputs are captured from current model output (circular). *Affects:* stages can
  regress undetected. *Mitigation:* author expected results independently; enforce
  reconciliation (exact coverage) per CW-EXEC-001 §12; N-03/N-04.
- **R-04 Smoke/runtime touches production (M7-14/09).** Runtime-stage certification writes to
  live `irr_jobs`/`irr_stage_runs`. *Affects:* production integrity; violates §6.2.
  *Mitigation:* isolated `run_id` scope + dedicated M7 tables (§13/§17); N-05 blocks acceptance.
- **R-05 Regression isolation leakage (M7-11).** Runner selects membership via shared prod
  time windows or contends with live jobs. *Affects:* A-M3/A-M4; non-reproducible runs.
  *Mitigation:* corpus-scoped membership + separate registry tables (§17); N-07.
- **R-06 Corpus mutability (M7-10).** Case inputs edited in place; `case_id` reused. *Affects:*
  historical comparability. *Mitigation:* content-addressed inputs + `index.json` hash gate; N-06.
- **R-07 External-provider latency dominates (A-M1).** The < 2-min metric is missed due to
  model latency, not tooling. *Affects:* perceived failure of the objective. *Mitigation:*
  measure tooling time excluding provider latency; certification/smoke use minimal token budgets.
- **R-08 Contract-first erosion (CW-ARCH-001 §9.3).** Hand-edited fixtures/tests drift from
  the contract. *Affects:* the core architectural invariant. *Mitigation:* generation-only
  policy; regenerate-and-diff in CI; N-02.
- **R-09 PF-1B dependency (RLS replay).** M7 regression tables inherit the `ensure_rls`
  non-deterministic-RLS caveat (PF-1B DRIFT-REPORT). *Affects:* reproducible provisioning of
  M7 tables. *Mitigation:* resolve the PF-1B RLS-replay decision before the isolation
  migration lands (§13/§22); use explicit `ENABLE RLS` on M7 tables.
- **R-10 Scope creep into 7A/8 (§6.8).** Certification "improvements" pull in retry/resilience
  or parallelization. *Affects:* milestone closes late/never. *Mitigation:* N-12; changes to
  scope require CW-GOV-001 §11 change control.
- **R-11 CI enforcement ambiguity.** Treating advisory `npm run verify` as a hard CI gate
  is out of scope (CI enforcement is a §6.8-adjacent exclusion). *Affects:* over-delivery.
  *Mitigation:* rollout keeps CI advisory (§14); enforcement is a separate future decision.

## 22. Open Decisions & Dependencies (must resolve before/at approval)

- **D-1:** Reuse `irr_regression_runs`/`irr_stage_runs` vs. new M7 registry tables (§13). Recommend
  new isolated tables to satisfy A-M4 cleanly.
- **D-2:** PF-1B RLS-replay decision (reorder `ensure_rls` first vs. explicit per-table
  `ENABLE RLS`) — blocks the M7 isolation migration (R-09). Take at PF-1B closure.
- **D-3:** Which stages justify fewer than 5 canonical cases (M7-04) — enumerate at build step 3.
- **D-4:** Test-runner choice (node's built-in test runner vs. a minimal in-repo harness) —
  keep dependency-light; decide at build step 1.
- **D-5:** `contract.yaml` location fix (root → `compiler/`) — cosmetic but blocks a clean
  `verify:compiler`; do at build step 1.

---

### Approval

This Design Review must be approved (CW-GOV-001 §4A) before any Milestone 7 implementation
begins. On approval, an Acceptance Report (§4A.2) is produced at closure, mapping evidence
to §18/§20. **Status: DRAFT — awaiting review. Implementation NOT authorized.**

# ComplianceWorxs Milestone Acceptance Specifications

**Document ID:** CW-GOV-001
**Version:** 1.0.0
**Status:** Approved Baseline — Architecture Baseline v1.0
**Effective Date:** July 12, 2026
**Document Owner:** ComplianceWorxs Architecture
**Closure Authority:** CEO / Milestone Owner

---

## 1. Purpose

This document governs what must be built now, what constitutes completion, what blocks closure, and what must be deferred.

It prevents the target architecture from becoming an indefinite active build.

Each milestone must define:

* objective;
* in-scope deliverables;
* explicit exclusions;
* required evidence;
* blocking-defect standard;
* deferred work;
* success metrics;
* closure authority.

---

## 2. Governing Principle

A requirement in the Platform Architecture Specification or Execution Specification Standard does not become current implementation scope unless an approved milestone explicitly includes it.

New findings must be classified as exactly one of:

* current blocking defect;
* current non-blocking defect;
* future milestone;
* backlog;
* rejected work.

A useful improvement does not automatically expand an active milestone.

---

## 3. Document Precedence

For current implementation scope:

1. The approved Milestone Acceptance Specification determines what is authorized now.
2. The Execution Specification Standard determines how authorized workflows are specified.
3. The Platform Architecture Specification determines long-term architectural direction.

The milestone specification may phase implementation of a target architecture capability. It may not authorize a direct violation of a permanent architectural invariant unless that exception is explicit, temporary, and approved.

---

## 4. Blocking-Defect Test

A defect blocks a milestone only when all four conditions are true:

1. It reproduces on the current deployed version.
2. It violates an in-scope milestone requirement.
3. It prevents the milestone objective from being achieved.
4. It has not been explicitly accepted or deferred by the milestone owner.

Historical failures from superseded code do not block closure unless they reproduce on the current version.

Transient provider failures do not block architectural closure unless resilience to that failure class is expressly in scope.

---

## 4A. Milestone Design Review Gate

No implementation work may begin on a milestone until a Milestone Design Review has been produced and approved for that milestone.

### 4A.1 Required contents

A Milestone Design Review must identify:

* planned files and components to be created or modified;
* migration steps, including any schema, contract, or data changes;
* risks, including what could go wrong and what it would affect;
* acceptance tests mapped to the milestone's success metrics in the governing milestone section.

### 4A.2 Sequence

```text
Milestone Design Review drafted
        ↓
Milestone Design Review approved
        ↓
Implementation authorized
        ↓
Acceptance Report produced at closure
```

Code must not be written against a milestone before its Design Review is approved. A Design Review is not itself an Execution Specification — it precedes and scopes the implementation; the Execution Specification (CW-EXEC-001) still governs how any workflow inside that milestone is specified.

### 4A.3 Purpose

This gate exists to surface architectural conflicts before they are discovered mid-implementation, consistent with what occurred during Milestone 6.

---

# 5. Milestone 6 — IRR Execution Foundation

## 5.1 Status

**Closed**

## 5.2 Closure Date

**July 12, 2026**

## 5.3 Objective

Deliver and prove the foundational IRR execution capability required to process production-scale decision records through staged reasoning with contract-controlled outputs, checkpointing, validation, persistence, and telemetry.

Milestone 6 is not the AI Services milestone.

It is the execution foundation required before product services can reliably consume structured reasoning.

## 5.4 In-Scope Deliverables

Milestone 6 required:

* deployed staged IRR execution engine;
* defined stage sequence and dependencies;
* production-scale batching where required;
* checkpointing of accepted stage or batch output;
* resume from completed checkpoints;
* central contract source for IRR output fields;
* generated prompt constraints;
* generated runtime validators;
* generated TypeScript contract types;
* final schema validation;
* persistence of job and stage state;
* telemetry for current-version successful and failed model calls;
* at least one successful production-scale end-to-end execution;
* no reproducible current-version defect silently propagating malformed required data across stage boundaries.

## 5.5 Closure Evidence

Milestone 6 closed based on:

* contract compiler deployed and used by the current engine;
* IRR stage engine deployed as v31;
* checkpoint and resume demonstrated;
* runtime contract validation demonstrated;
* telemetry persisted from a real current-version model call;
* production-scale job `0e860d75` completed all 15 stages successfully;
* historical D7 status-field corruption did not reproduce on v31;
* no confirmed current-version silent cross-stage corruption remained.

## 5.6 Explicit Exclusions

The following were not required for Milestone 6 closure:

* customer-facing product services;
* canonical regression corpus;
* regression-run batch isolation;
* compiler-generated fixtures;
* compiler-generated tests;
* one-command verification;
* centralized error taxonomy;
* final retry-policy architecture;
* network resilience improvements;
* continuous worker-owned scheduling;
* cron removal;
* parallel stage execution;
* sub-five-minute generation;
* CI enforcement;
* dashboards;
* elimination of every product-level defect;
* zero transient provider failures.

## 5.7 Reopening Rule

Milestone 6 must not be reopened for deferred work.

It may be reopened only if evidence establishes that its closure evidence was materially false or that the accepted foundation did not exist on the deployed version recorded at closure.

---

# 6. Milestone 7 — Developer Productivity and Verification

## 6.1 Status

**Planned**

## 6.2 Objective

Make routine development changes fast, repeatable, isolated, and safe to verify without using full production regression runs as the primary diagnostic mechanism.

## 6.3 Scope

Milestone 7 includes:

* verification-gate policy;
* compiler verification;
* stage certification libraries;
* five to ten canonical cases per stage where justified;
* compiler-generated valid fixtures;
* compiler-generated invalid fixtures;
* compiler-generated validator tests;
* compiler-generated prompt-fragment tests;
* repeatable smoke-test automation;
* canonical regression corpus;
* permanent regression case IDs;
* immutable case inputs or controlled versioning;
* regression run IDs;
* isolated regression batches;
* pass/fail reporting;
* one-command local verification;
* concise verification reports.

## 6.4 Verification Gates

| Gate                  | Trigger                                           | Purpose                           |
| --------------------- | ------------------------------------------------- | --------------------------------- |
| Compiler verification | Contract or schema edit                           | Prove generated artifacts agree   |
| Stage certification   | Stage code or prompt edit                         | Prove the modified stage          |
| Smoke test            | Stage edit after certification                    | Prove one complete execution      |
| Full regression       | Shared infrastructure change or release candidate | Prove release-level compatibility |

## 6.5 Required Command

The target developer command is:

```text
npm run verify
```

It must, as applicable:

1. compile contracts;
2. verify generated artifacts;
3. run unit tests;
4. identify modified stages;
5. run relevant stage certification;
6. produce a concise report.

## 6.6 Canonical Regression Corpus

The regression corpus must provide:

* stable `case_id`;
* human-readable case name;
* controlled input payload;
* scenario classification;
* expected terminal result;
* corpus version;
* immutable or explicitly versioned changes.

Regression results must provide:

* unique `run_id`;
* case-level result;
* stage and error for failures;
* aggregate pass/fail result;
* isolation from unrelated production jobs.

## 6.7 Success Metrics

Milestone 7 closes when:

* routine stage changes can be verified in under two minutes, excluding unavoidable external-provider latency;
* one complete smoke execution is repeatable;
* a regression run is isolated and attributable;
* shared production-table time windows are no longer used to define regression membership;
* the verification command produces an unambiguous report;
* release candidates can be verified without manual reconstruction.

## 6.8 Explicit Exclusions

Milestone 7 does not include:

* retry-policy redesign;
* centralized operational resilience;
* scheduler redesign;
* cron removal;
* worker-owned continuous execution;
* parallel execution optimization.

---

# 7. Milestone 7A — Resilient Execution

## 7.1 Status

**Planned**

## 7.2 Objective

Centralize failure classification and improve automatic recovery from transient model-provider, network, and operational conditions.

## 7.3 Scope

Milestone 7A includes:

* centralized error taxonomy;
* mapping stage-specific error codes to categories;
* centralized retry-policy evaluation;
* evidence-based retry limits;
* exponential backoff;
* jitter;
* rate-limit handling;
* timeout handling;
* network-error handling;
* circuit-breaker policy where justified;
* terminal-error normalization;
* retry and failure telemetry.

## 7.4 Error Categories

The target categories are:

* contract;
* business logic;
* model output;
* operational;
* infrastructure.

Stage-specific error codes may remain for diagnosis, but retry and terminal behavior must be controlled through the centralized category policy.

## 7.5 Initial Classification

| Error                  | Category                       | Initial Policy                              |
| ---------------------- | ------------------------------- | -------------------------------------------- |
| `generation_timeout`   | Operational                    | Retryable                                   |
| `network_error`        | Operational                    | Retryable                                   |
| `rate_limit`           | Operational                    | Retryable                                   |
| malformed model output | Model output                   | Conditional                                 |
| `contract_violation`   | Contract                       | Non-retryable                               |
| `schema_validation`    | Validation / business logic    | Non-retryable without changed input or code |
| `authentication_error` | Infrastructure / configuration | Non-retryable                               |

Final retry counts must be determined from observed behavior rather than arbitrary fixed values.

## 7.6 Success Metrics

Milestone 7A closes when:

* retry behavior is controlled centrally;
* transient failures normally recover without manual requeue;
* deterministic failures are not repeatedly retried unchanged;
* retry attempts and delays are measurable;
* terminal failures remain explicit and diagnosable;
* circuit-breaking exists where operational evidence justifies it.

## 7.7 Explicit Exclusions

Milestone 7A does not include:

* product-service development;
* full scheduler redesign;
* removal of checkpointing;
* latency optimization unrelated to resilience.

---

# 8. Milestone 8 — Execution Engine Optimization

## 8.1 Status

**Planned**

## 8.2 Objective

Reduce end-to-end IRR generation latency without weakening validation, checkpointing, resumability, or reliability.

## 8.3 Scope

Milestone 8 includes:

* replace cron-driven normal stage advancement;
* implement worker-owned consecutive execution;
* retain cron or an equivalent mechanism for recovery only;
* preserve stage and batch checkpoints;
* preserve stalled-job reclamation;
* assess independent stages for safe parallel execution;
* measure baseline and post-change latency;
* measure throughput;
* measure recovery behavior;
* eliminate artificial inter-stage waiting.

## 8.4 Required Architecture

Normal execution should follow:

```text
Worker claims job
        ↓
Run next stage
        ↓
Validate
        ↓
Persist checkpoint
        ↓
Run next eligible stage immediately
```

Recovery execution should:

* identify abandoned or stalled work;
* reclaim safely;
* resume from the latest accepted checkpoint.

## 8.5 Success Metrics

Milestone 8 closes when:

* typical IRR generation is under five minutes, subject to provider latency and document scale;
* median and P95 generation time are measured and documented;
* cron no longer participates in normal stage progression;
* worker failure resumes from the latest accepted checkpoint;
* throughput is equal to or better than the Milestone 6 baseline;
* reliability is equal to or better than the Milestone 6 architecture.

## 8.6 Explicit Prohibitions

Milestone 8 must not:

* remove validation to gain speed;
* eliminate checkpoints;
* combine reasoning stages solely to reduce calls;
* weaken traceability;
* change regulatory reasoning without an approved Execution Specification change.

---

# 9. Subsequent Milestone — AI Services

## 9.1 Status

**Not Yet Authorized**

## 9.2 Objective

Build customer-facing services that consume approved Execution Specifications, Prompt Specifications, and validated reasoning records.

## 9.3 Candidate Services

* Article Service;
* Case File Service;
* Executive Brief Service;
* Landing Page Service;
* Inspection Resource Service;
* Email Service;
* LinkedIn Service;
* IRR rendering and delivery services.

## 9.4 Governing Principle

AI Services do not independently determine regulatory reasoning.

They consume validated reasoning and perform approved:

* transformation;
* selection;
* rendering;
* formatting;
* delivery.

## 9.5 Entry Criteria

An AI Service may begin only when:

* its product or editorial contract is approved;
* its workflow has an approved Execution Specification;
* required fields exist in the contract registry;
* the execution engine can produce the required validated record;
* its artifact contract is defined;
* an approved milestone authorizes implementation.

---

# 10. Defect Backlog

Current known non-blocking defect:

## Stage 11 Nondeterministic Duplicate Scaffold

**Status:** Backlog
**Severity:** Non-urgent
**Current Evidence:** Did not reproduce on clean replay
**Disposition:** Does not reopen Milestone 6

Future handling should include:

* stable gap identifiers;
* canonical item shape;
* duplicate detection;
* exact one-output-per-gap reconciliation;
* targeted replay fixture.

---

# 11. Milestone Change Control

A milestone change requires:

* documented scope change;
* reason for the change;
* impact on schedule and acceptance;
* explicit owner approval;
* version update.

A newly discovered architectural improvement must not be added informally.

---

# 12. Closure Authority

The milestone owner may close a milestone when its required evidence satisfies the approved acceptance criteria.

Contributors may recommend that a milestone remain open. They may not silently expand its scope.

---

# 13. Final Governance Rule

The documents serve distinct functions:

* **Platform Architecture Specification:** where the system is going.
* **Execution Specification Standard:** how workflows must be defined.
* **Milestone Acceptance Specifications:** what must be built and proven now.

For active delivery scope, this document controls.

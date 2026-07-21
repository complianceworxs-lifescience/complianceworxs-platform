# CW-INV-001 — The Evidence Integrity Invariant (Product Requirement #1)

**Status:** FOUNDATIONAL INVARIANT — governs every stage, prompt, validator, and reviewer in the
IRR pipeline. Supersedes all engineering/performance milestones in priority.
**Type:** Product Requirement #1 (invariant), superordinate to milestones (CW-GOV-001) and
architecture (CW-ARCH-001).
**Owner / Authority:** CEO / Founder. This document records the founding principle as articulated
by the Owner (2026-07-20); the author (implementer) documents it and does not define it.
**Date:** 2026-07-20
**Origin:** Discovered by putting a completed IRR "on trial" against a signatory's standard
(Decision Quality Validation, job `5d6ea959`). See §4.

---

## 1. The founding principle this protects

ComplianceWorxs exists to **preserve the reasoning that actually existed at the time of a GMP
authorization** — so that a QA executive can sign it and it will survive an FDA investigator's
scrutiny. The entire value of the product is fidelity to what was real.

**If the system invents evidence, it is not preserving reasoning — it is reconstructing fiction.**
That is the exact opposite of the category. A fabricated record is not a weaker version of the
product; it is the anti-product, and it is an inspection liability the moment it is signed.

## 2. The invariant (PR-1)

> **The IRR shall never represent evidence, records, observations, prior events, calculations, or
> regulatory artifacts that were not explicitly provided by the user or deterministically derived
> from supplied evidence.**

And the rule that governs every prompt, stage, validator, and reviewer:

> **Unknown is always preferable to invented.**

## 3. The three-and-only-three sentence types

Every sentence in an IRR must be classifiable as exactly one of:

1. **Observed** — directly supported by supplied evidence.
2. **Reasoned** — logically derived from observed evidence (the derivation must be visible).
3. **Missing** — required evidence that was **not** supplied (named as absent, with its effect on
   confidence stated).

**If a sentence cannot be labeled as one of these three, it must not exist in the artifact.** No
inferred document numbers. No imaginary batch history. No invented stability reports. No fabricated
SOPs. No fictional CAPAs. No synthetic quality events. No assumed calculations.

## 4. The evidence that forced this invariant (concrete, do not soften)

A completed IRR (job `5d6ea959`, real "Lot 24P3487" dissolution-release decision) was evaluated
against the question: *"Would Patricia Trubl sign this without being told AI wrote it?"* The input
contained exactly three data points — dissolution **68%**, f2 similarity **62**, assay **99.2%**.
The record's inspector-challenge **responses** answered investigator questions by citing documents
and data that **were never provided and do not exist**, presented as fact:

- *"process capability assessment documented in **Quality Event QE-2024-0891** … most recent 30
  batches … mean dissolution of **78.3%** … **Cpk of 1.05** … preceded by conforming batches at
  **76%, 81%, and 74%**"*
- *"validated analytical method per **SOP-AN-045**, with method validation report **MV-2019-132**
  demonstrating repeatability RSD of **1.8%**"*
- *"**Stability protocol ST-PRD-2022-089** … Lots **23P2981 at 69%, 23P3156 at 67%, 24P1203 at
  68%** all maintained dissolution above 70% through 18-month stability … **Annual Product Review
  APR-2023-PRD-045** … 3-month pull scheduled for **June 2024**"*

None of it was supplied. Signing this record means attesting to the existence of quality events,
validation reports, and stability datasets that do not exist — a data-integrity violation
(ALCOA+, 21 CFR Part 11). **Verdict: not signable.** Not because the writing is poor — it is
fluent and regulatorily sophisticated — but because it fabricates. (A secondary defect: the prose
also contradicts itself on the f2 statistic across sections.)

## 5. The encouraging finding — this is governance, not intelligence

The same record's `knownLimitations` section **told the truth**: it correctly named what was
missing ("no historical dissolution trend data… no measurement-uncertainty analysis… no
bioequivalence-study linkage"). So the reasoning engine **already distinguishes evidence-supplied
from evidence-absent.** A later stage — the one that produces a *persuasive narrative* / challenge
responses — then destroys that discipline by inventing support to look complete.

**Therefore the fix is not a smarter model; it is governance.** The capability to be truthful is
already present; the pipeline must stop over-riding it in pursuit of persuasiveness.

## 6. The required behavior change

Current (prohibited) behavior:
```
Missing evidence  →  invent plausible support  →  produce a convincing narrative
```
Required behavior:
```
Missing evidence  →  state exactly what is missing  →  explain why it matters
                  →  describe how the absence affects confidence  →  stop
```
The absence must never be crossed. The current *"action item to retrieve X"* framing in the
challenge responses is the **right** instinct — keep it; delete the invented specifics that
accompany it.

## 7. The objective-function difference (why the category is different)

- Most AI systems optimize: **produce the most convincing answer.**
- ComplianceWorxs must optimize: **produce the most defensible record.**

These are different objective functions and sometimes produce opposite outputs. The truthful
record ("No historical trend data was provided; long-term process capability cannot be assessed;
confidence is reduced.") is **more** valuable than the fabricated one — it earns *"good catch,"* not
*"where is QE-2024-0891?"* A reputation as **the AI that never fabricates evidence** is a moat no
runtime optimization can match.

## 8. Enforcement (what this changes, effective immediately)

1. **Commercial outreach is HELD** until every sentence in a produced IRR can be classified as
   Observed / Reasoned / Missing — nothing else. The first real QA-leader evaluation must not be
   the thing that teaches a prospect the system fabricates.
2. **This invariant outranks latency and Stage 11.** Runtime optimization stays paused
   (CW-MDR-008-M8-Stage11-and-Engineering-Pause); evidence integrity is the top priority.
3. **Prompt/stage scope of the fix (design, not yet built):** the reasoning stages must be
   instructed to assert only from supplied evidence and to render absence as *Missing*. Primary
   offenders are the narrative/response stages (inspector-challenge *responses*, and any part of the
   authorization rationale that asserts unsupplied specifics). The gap-identification stages
   (`knownLimitations`, inspector-challenge *gaps*) already comply and are the model to extend.
4. **A new acceptance gate:** an IRR does not pass — and does not ship, demo, or reach a customer —
   unless a validator/reviewer can label every sentence O/R/M and finds **zero** fabricated
   evidence. This becomes a first-class item on the production-readiness gate, above median/P95
   latency.

## 9. Status of prior work under this reframe

- **Engineering (M8 runtime):** correct as far as it went (the pipeline completes, recovers, loses
  no data) — but it was validating the *engine*, not the *artifact*. Remains paused.
- **The real product risk** is here, in the artifact's evidence integrity — an order of magnitude
  more important than latency or Stage 11.
- The milestone that matters is unchanged in spirit but sharper in dependency: *a paying customer
  makes the IRR part of their authorization process* — which cannot happen until PR-1 holds,
  because a QA leader who catches one fabricated citation never trusts the system again.

---

**This is the boundary that defines the category.** If ComplianceWorxs becomes known as the AI that
never fabricates evidence, that is a durable competitive advantage. PR-1 is therefore not a
constraint on the product — it *is* the product.

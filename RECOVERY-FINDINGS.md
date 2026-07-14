# PF-1A Recovery — Findings for Later Triage

Informal notes surfaced during PF-1A recovery. **Not** an approved governance
change. Each item is logged here for later decision; none should be treated as
authorized scope until dispositioned by the milestone owner.

## 1. PF-1A / PF-1B are not defined in the governance baseline (governance gap)

`PF-1A` and `PF-1B` appear only in this repo's `README.md` and
`RECOVERY_MANIFEST.md`. They are **not** referenced anywhere in the approved
baseline documents (`docs/CW-GOV-001`, `docs/CW-EXEC-001`, `docs/CW-ARCH-001`).

Consequences to be aware of:

- The milestone gate commonly described as "Milestone 7 cannot start until PF-1A
  closes" is **not written into CW-GOV-001**. CW-GOV-001 §4A is a *Milestone
  Design Review* gate ("no implementation work may begin on a milestone until a
  Milestone Design Review has been produced and approved"), not a
  PF-1A-completion gate, and it does not mention a "stable engineering baseline."
- Per CW-GOV-001, the milestone sequence is Milestone 6 (Closed) → Milestone 7
  (Planned) → 7A → 8 → AI Services (Not Yet Authorized). PF-1A/PF-1B sit outside
  that sequence as a recovery/foundation effort recorded only in the README.
- Per CW-ARCH-001 §13 and CW-GOV-001 §13, the baseline documents are the
  "constitution" and the README is subordinate — so a gate that lives only in the
  README is informal.

**Decision for later (owner):** either formalize PF-1A/PF-1B into CW-GOV-001 via
its §11 milestone-change-control (documented scope change, reason, impact,
explicit owner approval, version update), or explicitly leave them as an informal
pre-milestone foundation effort. Do not fix silently — §11 requires owner
approval and a version bump.

## 2. RECOVERY_MANIFEST.md Summary line was stale (corrected)

The manifest Summary previously read "Total tracked: 91 (2 compiler assets + 89
edge functions)" while its own tables already listed all 94 deployed edge
functions. This was the source of the "94 vs 89" confusion — a stale count, not
missing/new functions. Summary corrected to 96 (2 + 94).

## 3. Contract-compiler layout mismatch (minor, note for PF-1A tidy-up)

`compiler/compile.js` reads its contract from `path.join(__dirname,
'contract.yaml')` (i.e. `compiler/contract.yaml`), but the recovered
`contract.yaml` lives at the repo root. Compiler verification was run by
supplying the root `contract.yaml` to the compiler; result was byte-exact
(compiled `contract-generated.ts` == the deployed
`edge-functions/irr-stage-engine/contract-generated.ts`, 11,978 bytes, identical
sha256). The path/layout should be reconciled during PF-1A tidy-up or Milestone 7
compiler-verification work (recovery discipline: no refactor until PF-1A closes).

## 4. `blank-template-send` referenced but not deployed

`edge-functions/case-file-render/index.ts` calls a
`.../functions/v1/blank-template-send` endpoint, but no `blank-template-send`
function is deployed in Supabase project `balkvbmtummehgbbeqap` (not among the 94)
and it is not tracked in the manifest. Phantom reference — flag for later review
(renamed, removed, or never-deployed dependency).


-- Canonical IRR format specification — locked from Wells Pharma CAPA v3 (2026-05-15).
-- This is the signature CW pattern. Build scripts and the irr-generate function
-- reference these required sections. Do not modify without explicit version bump.

CREATE TABLE IF NOT EXISTS public.irr_format_spec (
  id            text PRIMARY KEY,
  version       text NOT NULL,
  locked_at     timestamptz NOT NULL DEFAULT now(),
  locked_from   text NOT NULL,           -- the artifact that established this version
  required_sections jsonb NOT NULL,       -- ordered list of section labels
  signature_patterns jsonb NOT NULL,      -- the CW signature elements
  notes         text
);

INSERT INTO public.irr_format_spec (id, version, locked_from, required_sections, signature_patterns, notes)
VALUES (
  'cw-irr-canonical',
  'v3-2026-05-15',
  'IRR-2026-0515-503B-WLP-CAPA-0002 (Wells Pharma / Patricia Trubl)',
  jsonb_build_array(
    'control_bar',
    'header',
    'fields_grid',
    'investigator_question',
    'retrieval_context',
    'authorization_summary',
    'evidence_reviewed',
    'evidence_explicitly_not_relied_upon',
    'risk_evaluation',
    'authorization_rationale',
    'regulatory_alignment',
    'residual_exposure',
    'approval',
    'known_limitations'
  ),
  jsonb_build_object(
    'retrieval_context', 'session timing, checklist version, room, source systems, deferred-item status',
    'exclusion_logic', 'each excluded evidence item: rejection rationale + exclusion owner + exclusion timestamp',
    'recurrence_hypotheses', 'numbered alternative recurrence scenarios with invalidation logic per hypothesis',
    'residual_exposure', 'bounded uncertainty framing — name conditions not represented in the validation window',
    'linked_records', 'system URIs to change-control, qualification packages, parent records (esig://, chain://, audit-ref://)',
    'bounded_authorization', 'closure logic scoped to window duration; routine controls explicitly distinguished from CAPA controls',
    'operational_shorthand', 'abbreviated reviewer notation (PT/QSM/RH), terser line density, mixed abbreviations (anlst/wkly/devs)',
    'evidence_lineage', 'per-evidence REPO / TS / REV metadata block adjacent to each item',
    'human_judgment_fragment', 'one compressed operator line in the rationale conclusion, signed with initials',
    'approval_asymmetry', 'uneven timestamp precision, partial fields, inherited chain entries, system-generated e-sig refs',
    'known_limitations_phrasing', 'bounded-residual framing — never "None identified"'
  ),
  'Locked after three rounds of external review. Wells Pharma CAPA v3 is the reference artifact. Subsequent IRRs across decision types (CAPA, OOS, deviation, sterility, release authorization) must include all 14 sections and exhibit all signature patterns. Do not iterate format further — leverage shifts to operationalization.'
);

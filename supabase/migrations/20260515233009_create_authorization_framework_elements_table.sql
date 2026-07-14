-- Canonical authorization framework — the immutable structure every IRR follows
-- Locked as a reference table to prevent domain drift
-- Order matters: this is the cognitive order QA leaders use

CREATE TABLE IF NOT EXISTS authorization_framework_elements (
  element_number INT PRIMARY KEY,
  element_name TEXT NOT NULL UNIQUE,
  element_description TEXT NOT NULL,
  is_required BOOLEAN DEFAULT TRUE,
  framework_version TEXT DEFAULT 'v1.0',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO authorization_framework_elements (element_number, element_name, element_description, is_required) VALUES
(1,  'authorization_event',       'The specific decision being authorized', TRUE),
(2,  'investigator_question',     'The inspector challenge this IRR defends against', TRUE),
(3,  'authorization_rationale',   'Why the decision was justified', TRUE),
(4,  'evidence_reviewed',         'Evidence considered in the decision', TRUE),
(5,  'evidence_excluded',         'Evidence deliberately excluded and why', TRUE),
(6,  'alternative_hypotheses',    'Competing hypotheses considered', TRUE),
(7,  'residual_uncertainty',      'Risk accepted at authorization time', TRUE),
(8,  'boundary_conditions',       'Scope and limits of the authorization', TRUE),
(9,  'retrieval_lineage',         'Source chain for evidence reconstruction', TRUE),
(10, 'approval_chain',            'Decision owner and concurring authorities', TRUE)
ON CONFLICT (element_number) DO NOTHING;

COMMENT ON TABLE authorization_framework_elements IS
'The immutable canonical authorization framework. Every IRR across every authorization domain must follow this structure. Order reflects QA leader cognitive flow: authorization event and rationale are the core act, everything else supports them. Do not modify without explicit architecture review.';
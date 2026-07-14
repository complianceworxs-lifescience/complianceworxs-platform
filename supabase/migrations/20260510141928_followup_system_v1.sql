-- ============================================================
-- Follow-up system v1
-- Adds 7-touch cadence drafter + dispatcher infrastructure
-- ============================================================

-- 1. Add follow-up draft storage to warm_outbound_staging
ALTER TABLE public.warm_outbound_staging
  ADD COLUMN IF NOT EXISTS followup_drafts jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.warm_outbound_staging.followup_drafts IS
  'Array of {touch_number, subject, body, drafted_at, sent_at, message_id, status}. One entry per follow-up touch generated.';

-- 2. Add follow-up sequence reset columns (for replied/archived state)
ALTER TABLE public.warm_outbound_staging
  ADD COLUMN IF NOT EXISTS followup_completed_at timestamp with time zone;

COMMENT ON COLUMN public.warm_outbound_staging.followup_completed_at IS
  'Set when contact has received all 7 touches without reply. Triggers nurture handoff.';

-- 3. Cadence definition table
CREATE TABLE IF NOT EXISTS public.outbound_followup_cadence (
  touch_number integer PRIMARY KEY,
  days_after_previous integer NOT NULL,
  angle text NOT NULL,
  guidance text,
  active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.outbound_followup_cadence IS
  'Defines the 7-touch follow-up cadence. touch_number 1 = first follow-up after first_touch send. Each row defines days between previous touch and this one, plus the angle/framing for the drafter.';

-- 4. Insert the 7-touch cadence
-- Spacing follows industry standard for B2B outbound: tighten early, widen late, give room to breathe
INSERT INTO public.outbound_followup_cadence (touch_number, days_after_previous, angle, guidance) VALUES
  (1, 3,  'inspector_question_reframe',
    'Reframe the inspector question from a different angle than the first touch. If first touch asked "who authorized release", touch 1 asks "where does that rationale live during inspection". Keep under 80 words. No re-introduction. Reference the prior message implicitly only.'),
  (2, 5,  'specific_483_pattern',
    'Reference a specific recent 483 observation pattern relevant to the contact''s industry. Use the public FDA 483 record. Frame: "Saw three 503Bs cited in the last 6 months for X. The common pattern is Y." End with a one-line question. Under 90 words.'),
  (3, 7,  'asset_drop_no_ask',
    'Send a single useful asset (the IRR framework PDF, a relevant case file URL, or a public 483 analysis). No ask. Frame: "Thought this might be useful regardless of whether we connect — it''s the framework I send to QA leaders preparing for [specific scenario]." Under 70 words.'),
  (4, 10, 'peer_reference',
    'Reference a peer scenario without naming the customer. Frame: "A QA leader at a similar 503B told me the question that surprised them most during inspection was X." End with: "Curious if your team has surfaced this question yet." Under 90 words.'),
  (5, 14, 'breakup_soft',
    'Soft breakup. Frame: "I''ve been reaching out about [specific issue]. If the timing isn''t right or you''re handling this differently, I won''t keep pinging — just reply ''not now'' and I''ll close the loop." Under 70 words. This filters genuine non-fits cleanly.'),
  (6, 21, 'value_recap_with_ask',
    'Recap of what CW does in one sentence, paired with a specific ask. Frame: "Quick recap: ComplianceWorxs generates the authorization record FDA inspectors ask for during 503B inspections. Worth a 15-minute call to show you the actual artifact?" Under 80 words.'),
  (7, 30, 'breakup_final',
    'Final breakup. Frame: "Closing your file on my end. If 503B inspection authorization records become a priority, you''ve got my contact. Best with the next inspection." Under 60 words. No ask. Permission-based exit.')
ON CONFLICT (touch_number) DO UPDATE SET
  days_after_previous = EXCLUDED.days_after_previous,
  angle = EXCLUDED.angle,
  guidance = EXCLUDED.guidance,
  active = EXCLUDED.active;

-- 5. Index for the dispatcher query
CREATE INDEX IF NOT EXISTS idx_warm_outbound_followup_due
  ON public.warm_outbound_staging (next_followup_due_at)
  WHERE replied_at IS NULL
    AND automation_paused = false
    AND archived_at IS NULL
    AND followup_completed_at IS NULL
    AND is_paying_customer = false;

-- 6. Helper view for monitoring follow-up state
CREATE OR REPLACE VIEW public.followup_pipeline_state AS
SELECT
  COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL AND sequence_email_count = 0 AND replied_at IS NULL) AS first_touch_sent_no_followup,
  COUNT(*) FILTER (WHERE next_followup_due_at <= NOW() AND replied_at IS NULL AND automation_paused = false) AS overdue_followups,
  COUNT(*) FILTER (WHERE sequence_email_count >= 1 AND sequence_email_count < 7 AND replied_at IS NULL) AS in_followup_sequence,
  COUNT(*) FILTER (WHERE sequence_email_count >= 7) AS sequence_completed,
  COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied_total,
  COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived_total
FROM public.warm_outbound_staging
WHERE is_paying_customer = false;
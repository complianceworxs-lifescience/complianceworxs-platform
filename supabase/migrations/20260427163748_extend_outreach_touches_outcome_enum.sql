
ALTER TABLE outreach_touches DROP CONSTRAINT IF EXISTS outreach_touches_outcome_check;

ALTER TABLE outreach_touches ADD CONSTRAINT outreach_touches_outcome_check
  CHECK (outcome = ANY (ARRAY[
    'irr'::text,
    'case_file'::text,
    'purchase'::text,
    'no_response'::text,
    'in_progress'::text,
    'replied_no_trigger'::text,
    'replied_interested'::text,
    'replied_objection'::text,
    'replied_referred'::text,
    'meeting_booked'::text,
    'closed_lost'::text,
    NULL::text
  ]));

UPDATE outreach_touches
SET outcome = 'replied_no_trigger'
WHERE target_name = 'Joseph Lambert Pharm.D. BCSCP'
  AND reply_received = TRUE
  AND outcome = 'no_response';

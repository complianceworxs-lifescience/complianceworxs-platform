-- send_today: prefer email over linkedin_dm so the auto-send channel actually fires
-- LinkedIn DMs Jon executes manually from the no_email_manual_outreach workbook
-- Only inverting the channel preference; everything else preserved

CREATE OR REPLACE VIEW send_today AS
 WITH cooled AS (
         SELECT s.id AS staging_id,
            s.full_name,
            s.first_name,
            s.company,
            s.job_title,
            s.linkedin_url,
            s.email,
            s.attio_record_id,
            s.fit_score,
            s.role_function,
            s.case_file_interest,
                CASE
                    WHEN (s.email IS NOT NULL AND s.email <> '') THEN 'email'::text
                    WHEN (s.linkedin_url IS NOT NULL) THEN 'linkedin_dm'::text
                    ELSE NULL::text
                END AS recommended_channel,
            (COALESCE(( SELECT count(*) AS count
                   FROM outbound_log o
                  WHERE (o.staging_id = s.id)), (0)::bigint) + 1) AS next_touch,
            ( SELECT max(o.sent_at) AS max
                   FROM outbound_log o
                  WHERE (o.staging_id = s.id)) AS last_sent_at,
            (EXTRACT(epoch FROM (now() - ( SELECT max(o.sent_at) AS max
                   FROM outbound_log o
                  WHERE (o.staging_id = s.id)))) / (86400)::numeric) AS days_since_touch,
                CASE lower(COALESCE(s.target_account_priority, ''::text))
                    WHEN 'high'::text THEN 3
                    WHEN 'medium'::text THEN 2
                    WHEN 'low'::text THEN 1
                    ELSE 0
                END AS company_priority,
            lower(COALESCE(NULLIF(split_part(s.email, '@'::text, 2), ''::text), s.company_domain, s.company)) AS domain_key
           FROM warm_outbound_staging s
          WHERE ((s.archived_at IS NULL) AND (s.replied_at IS NULL) AND (s.fit_score >= 75) AND (COALESCE(s.last_attio_status, ''::text) <> ALL (ARRAY['Disqualified'::text, 'Purchased'::text])) AND ((s.linkedin_url IS NOT NULL) OR (s.email IS NOT NULL)) AND ((s.automation_paused IS NULL) OR (s.automation_paused = false)))
        ), ranked AS (
         SELECT cooled.*,
                CASE
                    WHEN (cooled.last_sent_at IS NULL) THEN true
                    WHEN ((cooled.recommended_channel = 'linkedin_dm'::text) AND (cooled.days_since_touch >= (3)::numeric)) THEN true
                    WHEN ((cooled.recommended_channel = 'email'::text) AND (cooled.days_since_touch >= (4)::numeric)) THEN true
                    ELSE false
                END AS due_to_send,
                CASE
                    WHEN ((cooled.next_touch > 3) AND (cooled.days_since_touch < (90)::numeric)) THEN false
                    ELSE true
                END AS within_touch_cap,
            row_number() OVER (PARTITION BY cooled.domain_key ORDER BY cooled.company_priority DESC, cooled.fit_score DESC, cooled.staging_id) AS domain_rank,
            ((cooled.company_priority * 1000) + cooled.fit_score) AS priority_score
           FROM cooled
        ), eligible AS (
         SELECT ranked.*
           FROM ranked
          WHERE ((ranked.due_to_send = true) AND (ranked.within_touch_cap = true) AND (ranked.domain_rank = 1))
        ), with_hook AS (
         SELECT eligible.*,
                CASE
                    WHEN ((eligible.case_file_interest ~~* '%batch%release%'::text) OR (eligible.case_file_interest ~~* '%release%authorization%'::text)) THEN (eligible.first_name || ', when an FDA inspector asks who authorized a batch release during a deviation or with a borderline lab result, your team has to produce the decision logic on demand. At most sites the record doesn''t exist until you build it under questioning. That gap is what I work on.'::text)
                    WHEN ((eligible.case_file_interest ~~* '%deviation%'::text) OR (eligible.case_file_interest ~~* '%root%cause%'::text)) THEN (eligible.first_name || ', when an FDA inspector asks how you concluded a deviation was non-recurring, your team has to reconstruct the rationale from emails and meeting notes. The signed deviation form isn''t the authorization record. That gap is what I work on.'::text)
                    WHEN (eligible.case_file_interest ~~* '%capa%'::text) THEN (eligible.first_name || ', when an FDA inspector asks how you proved a CAPA was effective — not just closed — most QA teams can''t produce the decision record on demand. The closure form isn''t the effectiveness rationale. That gap is what I work on.'::text)
                    WHEN (eligible.case_file_interest ~~* '%change%control%'::text) THEN (eligible.first_name || ', when an FDA inspector examines your change control decisions, they''re asking one question: who determined this was major vs minor vs non-reportable, and what was the documented basis? A signed change form is not a filing determination record. That gap is what I work on.'::text)
                    WHEN ((eligible.case_file_interest ~~* '%oos%'::text) OR (eligible.case_file_interest ~~* '%out%of%spec%'::text)) THEN (eligible.first_name || ', when an FDA inspector asks how you justified an OOS invalidation, your team has to reconstruct the rationale post-hoc. The Phase II investigation report isn''t the authorization record for invalidation. That gap is what I work on.'::text)
                    WHEN (eligible.case_file_interest ~~* '%data%integrity%'::text) THEN (eligible.first_name || ', when an FDA inspector asks who authorized a data review exception or audit trail override, most teams can''t produce a contemporaneous record. The audit trail shows what happened, not who authorized the deviation from procedure. That gap is what I work on.'::text)
                    WHEN (eligible.case_file_interest ~~* '%supplier%'::text) THEN (eligible.first_name || ', when an FDA inspector asks how you qualified a supplier for a critical material — and what justified the risk classification — the audit report isn''t the authorization record. The decision logic behind the risk call is rarely captured. That gap is what I work on.'::text)
                    WHEN ((eligible.case_file_interest ~~* '%stability%'::text) OR (eligible.case_file_interest ~~* '%oot%'::text)) THEN (eligible.first_name || ', when an FDA inspector asks how you concluded a stability OOT was non-significant, your team has to reconstruct the trend analysis logic. The data table isn''t the disposition rationale. That gap is what I work on.'::text)
                    WHEN (eligible.case_file_interest ~~* '%complaint%'::text) THEN (eligible.first_name || ', when an FDA inspector asks how you classified a complaint as non-reportable, the closure record isn''t the reportability decision. The logic behind that call is rarely captured at the moment. That gap is what I work on.'::text)
                    WHEN (eligible.case_file_interest ~~* '%process%validation%'::text) THEN (eligible.first_name || ', when an FDA inspector asks how you concluded process validation succeeded — not just that the protocol passed — the validation report isn''t the conclusion authorization. That gap is what I work on.'::text)
                    ELSE (((eligible.first_name || ', when an FDA inspector at '::text) || eligible.company) || ' asks who authorized a critical compliance decision and on what basis, most QA teams can''t produce the record on demand. The signed form isn''t the authorization logic. That gap is what I work on.'::text)
                END AS draft_hook,
                CASE
                    WHEN (eligible.case_file_interest ~~* '%batch%release%'::text) THEN 'Batch Release Authorization'::text
                    WHEN (eligible.case_file_interest ~~* '%deviation%'::text) THEN 'Deviation Root Cause'::text
                    WHEN (eligible.case_file_interest ~~* '%capa%'::text) THEN 'CAPA Effectiveness'::text
                    WHEN (eligible.case_file_interest ~~* '%change%control%'::text) THEN 'Change Control Risk'::text
                    WHEN (eligible.case_file_interest ~~* '%oos%'::text) THEN 'OOS Investigation'::text
                    WHEN (eligible.case_file_interest ~~* '%data%integrity%'::text) THEN 'Data Integrity'::text
                    WHEN (eligible.case_file_interest ~~* '%supplier%'::text) THEN 'Supplier Qualification'::text
                    WHEN (eligible.case_file_interest ~~* '%stability%'::text) THEN 'Stability OOT'::text
                    WHEN (eligible.case_file_interest ~~* '%complaint%'::text) THEN 'Complaint Investigation'::text
                    WHEN (eligible.case_file_interest ~~* '%process%validation%'::text) THEN 'Process Validation'::text
                    ELSE 'General Authorization Gap'::text
                END AS inspection_signal
           FROM eligible
        )
 SELECT staging_id,
    full_name AS name,
    company,
    job_title AS title,
    linkedin_url,
    email,
    recommended_channel AS channel,
    fit_score,
    next_touch,
    last_sent_at AS last_contact,
    round(days_since_touch, 1) AS days_since_last_contact,
    inspection_signal,
    draft_hook,
    attio_record_id,
    row_number() OVER (ORDER BY priority_score DESC, staging_id) AS rank
   FROM with_hook
  ORDER BY (row_number() OVER (ORDER BY priority_score DESC, staging_id))
 LIMIT 10;
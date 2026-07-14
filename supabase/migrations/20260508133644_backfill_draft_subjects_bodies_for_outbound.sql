-- Generate first_touch_draft_subject + first_touch_draft_body for unapproved leads with email
-- Uses inspector-frame voice mapped to case_file_interest

UPDATE warm_outbound_staging
SET 
  first_touch_draft_subject = CASE 
    WHEN case_file_interest ILIKE '%batch%release%' THEN 'The decision behind your last batch release'
    WHEN case_file_interest ILIKE '%capa%' THEN 'CAPA closure authorization'
    WHEN case_file_interest ILIKE '%deviation%' OR case_file_interest ILIKE '%root%cause%' THEN 'The authorization record behind a deviation'
    WHEN case_file_interest ILIKE '%change%control%' THEN 'The decision record behind change control'
    WHEN case_file_interest ILIKE '%oos%' THEN 'OOS invalidation authorization'
    WHEN case_file_interest ILIKE '%data%integrity%' THEN 'Data review exception authorization'
    WHEN case_file_interest ILIKE '%supplier%' THEN 'Supplier risk classification rationale'
    WHEN case_file_interest ILIKE '%stability%' OR case_file_interest ILIKE '%oot%' THEN 'Stability OOT disposition rationale'
    WHEN case_file_interest ILIKE '%complaint%' THEN 'Complaint reportability decision'
    WHEN case_file_interest ILIKE '%process%validation%' THEN 'Validation conclusion authorization'
    ELSE 'Decision authorization at ' || COALESCE(company, 'your site')
  END,
  
  first_touch_draft_body = CASE
    WHEN case_file_interest ILIKE '%batch%release%' OR case_file_interest ILIKE '%release%authorization%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'Most QA leaders' || COALESCE(' at ' || company, '') || ' can produce the batch record and the CoA. What they struggle to produce — under direct regulatory scrutiny, in the room, with an inspector waiting — is the authorization record behind the release decision.' || E'\n\n' ||
      'Not what the results showed. Who made the call, on what evidence, and why that conclusion was justified at that moment.' || E'\n\n' ||
      'I put the full scenario together here:' || E'\n\n' ||
      'cases.complianceworxs.com/batch-release-authorization' || E'\n\n' ||
      'Tell me if that''s the gap you''re working through.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%capa%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'Closing a CAPA isn''t the hard part. The hard part is demonstrating — under direct regulatory scrutiny — who authorized the closure, what evidence they reviewed at that moment, and why they concluded the corrective action was effective.' || E'\n\n' ||
      'The closure form isn''t the effectiveness rationale. Those are different artifacts.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/capa-effectiveness' || E'\n\n' ||
      'Tell me if that''s the gap you''re looking at.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%deviation%' OR case_file_interest ILIKE '%root%cause%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'Most quality teams can produce the deviation report. What they can''t produce quickly — under direct inspection pressure — is who authorized the risk disposition, on what evidence, and why that conclusion was justified at the moment the decision was made.' || E'\n\n' ||
      'The signed deviation form isn''t the authorization record. They''re different artifacts.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/deviation-root-cause' || E'\n\n' ||
      'Tell me if that''s the exposure you''re working through.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%change%control%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'Change control documentation is well understood. What''s less understood is the authorization record behind the risk determination — who evaluated the risk, what evidence they reviewed, and why they concluded the change was acceptable.' || E'\n\n' ||
      'A signed change form is not a filing determination record. They''re different artifacts.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/change-control-risk' || E'\n\n' ||
      'Tell me if that''s the gap you''re looking at.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%oos%' OR case_file_interest ILIKE '%out%of%spec%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'When an FDA inspector asks how you justified an OOS invalidation, your team has to reconstruct the rationale post-hoc. The Phase II investigation report isn''t the authorization record for invalidation. They''re different artifacts.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/oos-investigation' || E'\n\n' ||
      'Tell me if that''s what you''re working through.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%data%integrity%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'When an FDA inspector asks who authorized a data review exception or audit trail override, most teams can''t produce a contemporaneous record. The audit trail shows what happened, not who authorized the deviation from procedure. Those are different artifacts.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/data-integrity' || E'\n\n' ||
      'Tell me if that''s the gap you''re evaluating.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%supplier%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'When an FDA inspector asks how you qualified a supplier for a critical material — and what justified the risk classification — the audit report isn''t the authorization record. The decision logic behind the risk call is rarely captured.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/supplier-qualification' || E'\n\n' ||
      'Tell me if that''s what you''re working through.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%stability%' OR case_file_interest ILIKE '%oot%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'When an FDA inspector asks how you concluded a stability OOT was non-significant, your team has to reconstruct the trend analysis logic. The data table isn''t the disposition rationale. They''re different artifacts.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/stability-oot' || E'\n\n' ||
      'Tell me if that''s the gap you''re evaluating.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%complaint%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'When an FDA inspector asks how you classified a complaint as non-reportable, the closure record isn''t the reportability decision. The logic behind that call is rarely captured at the moment.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/complaint-investigation' || E'\n\n' ||
      'Tell me if that''s what you''re working through.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    WHEN case_file_interest ILIKE '%process%validation%' THEN
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'The validation protocol exists. The data exists. The summary report exists.' || E'\n\n' ||
      'What rarely exists as a formal record is who authorized the conclusion that the process was validated — based on what evidence, how risk was evaluated, and why that determination was justified at that moment.' || E'\n\n' ||
      'Full scenario:' || E'\n\n' ||
      'cases.complianceworxs.com/process-validation' || E'\n\n' ||
      'Tell me if that''s the gap you''re evaluating.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
    
    ELSE
      COALESCE(first_name, full_name) || ' —' || E'\n\n' ||
      'Most QA leaders' || COALESCE(' at ' || company, '') || ' can point to the documentation. What they struggle to answer — under direct regulatory scrutiny, in the room, with an inspector waiting — is who authorized a specific compliance decision, based on what evidence, and why that conclusion was justified at that moment.' || E'\n\n' ||
      'That''s a different question than whether the work was done. And it''s the one that rarely has a formal record behind it.' || E'\n\n' ||
      'I put the full scenario together here:' || E'\n\n' ||
      'cases.complianceworxs.com/batch-release-authorization' || E'\n\n' ||
      'Tell me if that''s the gap you''re evaluating.' || E'\n\n' ||
      'Jon Nugent' || E'\n' || 'Founder, ComplianceWorxs' || E'\n' || 'complianceworxs.com'
  END
WHERE first_touch_draft_body IS NULL
  AND email IS NOT NULL
  AND archived_at IS NULL
  AND replied_at IS NULL
  AND COALESCE(automation_paused, false) = false
  AND COALESCE(is_paying_customer, false) = false;
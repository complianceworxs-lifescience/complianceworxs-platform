-- Editable snapshot content store. Lets Jon edit copy in SQL editor without redeploying functions.
CREATE TABLE IF NOT EXISTS exposure_snapshots (
  case_file_slug text PRIMARY KEY,
  scenario_name text NOT NULL,
  case_file_id text,
  inspector_question text NOT NULL,
  what_file_likely_shows text NOT NULL,
  what_cannot_be_reconstructed text NOT NULL,
  observation_language text NOT NULL,
  missing_record_fields text[] NOT NULL,
  case_file_stripe_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO exposure_snapshots (case_file_slug, scenario_name, case_file_id, inspector_question, what_file_likely_shows, what_cannot_be_reconstructed, observation_language, missing_record_fields, case_file_stripe_url) VALUES

('process-validation-conclusion', 'Process Validation Conclusion', 'CF01',
 'Who authorized the conclusion that this process was validated, on what evidence, and how was residual risk evaluated at the moment of that decision?',
 'A validation protocol with approvals, executed protocol packages, deviation logs, and a summary report concluding the process is in a state of control.',
 'The reasoning that justified the validation conclusion. Specifically: which evidence was weighed, which residual risks were accepted, and which authorized signatory took accountability for that conclusion at that moment in time.',
 'Failure to document the scientific and risk-based rationale used to justify the conclusion that the manufacturing process is in a state of control, resulting in an inability to reconstruct the basis for the validation decision during inspection. The validation summary report does not identify the authorized decision-maker, the evidence specifically reviewed, or the residual risk evaluated at the time the conclusion was reached.',
 ARRAY[
   'Authorized signatory accountable for the validation conclusion',
   'Specific evidence reviewed and weighed at the moment of authorization',
   'Residual risk identified and accepted, with rationale',
   'Regulatory framework cited (21 CFR Part 211.100, Annex 15, GAMP 5)',
   'Timestamped authorization, separate from protocol execution dates',
   'Decision logic linking evidence to conclusion'
 ],
 'https://buy.stripe.com/fZu28qewP2NV6lDabb2cg0B'),

('batch-release-authorization', 'Batch Release Authorization', 'CF02',
 'Who authorized the release of this batch, what evidence did they review at that moment, and how was the disposition decision justified beyond the test results?',
 'A batch record, a Certificate of Analysis, in-process control data, and a release signature on the batch disposition form.',
 'The authorization logic behind the release decision. Specifically: which deviations were considered, which trending data was weighed, what the authorized releaser actually reviewed at the moment of signature, and how the cumulative risk picture was evaluated.',
 'Failure to document the evidence reviewed and the rationale applied by the authorized releaser at the time of batch disposition. The batch release record establishes that the release occurred but does not establish what was considered, what was excluded, or how the disposition was justified beyond passing test results.',
 ARRAY[
   'Authorized releaser identity and authority basis',
   'Specific deviations and OOS investigations reviewed at release',
   'Trending and cumulative quality data weighed',
   'Risk evaluation linking results to release conclusion',
   'Regulatory framework cited (21 CFR 211.22, EU GMP Annex 16)',
   'Timestamped authorization with rationale, not just signature'
 ],
 'https://buy.stripe.com/3cI6oG74n1JR8tLerr2cg0C'),

('oos-investigation', 'OOS Investigation Disposition', 'CF03',
 'Who authorized the conclusion that the OOS result was invalid, on what evidence, and how was the laboratory error determination justified at the moment of disposition?',
 'A completed OOS investigation report, retest data, root cause analysis, and a closure signature.',
 'The authorization logic behind the laboratory error determination or the decision to invalidate the original result. Specifically: which evidence specifically supported the invalidation, which alternative explanations were ruled out, and which authorized investigator took accountability for that conclusion.',
 'Failure to document the rationale used to justify the conclusion that the original out-of-specification result was invalid, including the specific evidence that supported invalidation and the reasoning by which alternative root causes were excluded. The investigation record concludes the disposition but does not reconstruct the decision logic that produced it.',
 ARRAY[
   'Authorized investigator accountable for the disposition conclusion',
   'Specific evidence supporting laboratory error or invalidation',
   'Alternative root causes considered and excluded, with rationale',
   'Regulatory framework cited (FDA Guidance for OOS, 21 CFR 211.192)',
   'Timestamped authorization separate from retest closure',
   'Decision logic linking evidence to invalidation conclusion'
 ],
 'https://buy.stripe.com/cNi8wObkD74b9xP9772cg0D'),

('deviation-root-cause-analysis', 'Deviation Risk Disposition', 'CF04',
 'Who authorized the risk disposition for this deviation, on what evidence, and how was the conclusion that product quality was not impacted justified at the moment of decision?',
 'A deviation report, a root cause analysis, an impact assessment, and a closure signature.',
 'The authorization logic behind the no-impact conclusion. Specifically: which evidence specifically supported the determination that quality was not impacted, which other lots were considered, and which authorized investigator took accountability for the disposition.',
 'Failure to document the scientific and risk-based rationale used to justify the conclusion that the deviation did not impact product quality, resulting in an inability to reconstruct the basis for the disposition decision during inspection. The deviation closure record establishes that the deviation was investigated but does not establish how the no-impact conclusion was reached.',
 ARRAY[
   'Authorized investigator accountable for the no-impact conclusion',
   'Specific evidence supporting the quality impact determination',
   'Other potentially affected lots considered, with rationale for exclusion',
   'Regulatory framework cited (21 CFR 211.192, ICH Q7, EU GMP Chapter 1)',
   'Timestamped authorization separate from deviation entry',
   'Decision logic linking evidence to disposition conclusion'
 ],
 'https://buy.stripe.com/bJe7sK1K374b39rfvv2cg0O'),

('change-control-risk', 'Change Control Risk Determination', 'CF05',
 'Who authorized the risk determination for this change, on what evidence, and how was the conclusion that the change did not require revalidation justified at the moment of decision?',
 'A change control form, an impact assessment, a categorization decision, and approval signatures.',
 'The authorization logic behind the risk categorization. Specifically: which evidence supported the categorization, which downstream systems and processes were considered, and which authorized signatory took accountability for the conclusion that the change was acceptable as classified.',
 'Failure to document the scientific and risk-based rationale used to justify the risk categorization of the change, including the specific evidence supporting the determination that revalidation, requalification, or regulatory notification was not required. The change control record establishes that the change was approved but does not reconstruct the reasoning that justified the risk classification.',
 ARRAY[
   'Authorized signatory accountable for the risk categorization',
   'Specific evidence supporting the risk classification',
   'Downstream systems, processes, and products considered',
   'Regulatory framework cited (ICH Q10, 21 CFR 211.100, Annex 15)',
   'Timestamped authorization separate from change implementation',
   'Decision logic linking evidence to categorization conclusion'
 ],
 'https://buy.stripe.com/3cI7sK0FZ9cjeS92IJ2cg0L'),

('capa-effectiveness', 'CAPA Effectiveness Closure', 'CF06',
 'Who authorized the conclusion that the CAPA was effective, on what evidence, and how was the determination that the corrective action prevented recurrence justified at the moment of closure?',
 'A CAPA record, completed action items, effectiveness check data, and a closure signature.',
 'The authorization logic behind the effectiveness conclusion. Specifically: which evidence specifically demonstrated that the corrective action prevented recurrence, what observation period was deemed sufficient, and which authorized owner took accountability for the closure decision.',
 'Failure to document the scientific and risk-based rationale used to justify the conclusion that the corrective action and preventive action were effective, including the specific evidence supporting the determination that recurrence had been prevented and the basis on which the observation period was deemed sufficient. The CAPA closure record establishes that the action was completed but does not reconstruct the reasoning that justified the effectiveness conclusion.',
 ARRAY[
   'Authorized owner accountable for the effectiveness conclusion',
   'Specific evidence demonstrating prevention of recurrence',
   'Observation period rationale and sufficiency determination',
   'Regulatory framework cited (21 CFR 211.192, ICH Q10, EU GMP Chapter 1)',
   'Timestamped authorization separate from action completion',
   'Decision logic linking evidence to effectiveness conclusion'
 ],
 'https://buy.stripe.com/9B6aEW9cv74beS98332cg0G'),

('data-integrity', 'Data Integrity Decision Trail', 'CF07',
 'Who authorized the data integrity determination for this record, on what evidence, and how was the conclusion that the data was attributable, contemporaneous, and accurate justified at the moment of decision?',
 'Audit trails, electronic records, user access logs, and a system validation summary.',
 'The authorization logic behind the data integrity determination. Specifically: which evidence supported the conclusion that data met ALCOA+ principles, which gaps or anomalies were evaluated and accepted, and which authorized signatory took accountability for the determination.',
 'Failure to document the rationale used to justify the conclusion that electronic records met data integrity requirements, including the specific evidence reviewed at the time of determination and the basis on which observed audit trail gaps or user access anomalies were accepted. The data integrity assessment establishes that the system was reviewed but does not reconstruct the decision logic that produced the conclusion.',
 ARRAY[
   'Authorized signatory accountable for the data integrity determination',
   'Specific evidence supporting ALCOA+ compliance',
   'Audit trail anomalies considered and accepted, with rationale',
   'Regulatory framework cited (21 CFR Part 11, Annex 11, MHRA GxP Data Integrity)',
   'Timestamped authorization separate from system implementation',
   'Decision logic linking evidence to integrity conclusion'
 ],
 'https://buy.stripe.com/9B67sKfATbkr5hz4QR2cg0H'),

('supplier-qualification', 'Supplier Qualification Decision', 'CF08',
 'Who authorized the qualification of this supplier, on what evidence, and how was the conclusion that the supplier met quality and regulatory requirements justified at the moment of decision?',
 'A supplier audit report, quality agreement, qualification questionnaire, and an approval signature.',
 'The authorization logic behind the qualification conclusion. Specifically: which evidence supported the determination that the supplier met requirements, which observed risks or audit findings were accepted, and which authorized signatory took accountability for the qualification.',
 'Failure to document the risk-based rationale used to justify the qualification of the supplier, including the specific evidence reviewed at the time of qualification and the basis on which observed audit findings or capability gaps were accepted. The supplier qualification record establishes that the supplier was approved but does not reconstruct the decision logic that justified the conclusion.',
 ARRAY[
   'Authorized signatory accountable for the qualification conclusion',
   'Specific evidence supporting capability and compliance',
   'Audit findings or capability gaps accepted, with rationale',
   'Regulatory framework cited (ICH Q7, 21 CFR 211.84, EU GMP Chapter 5)',
   'Timestamped authorization separate from audit completion',
   'Decision logic linking evidence to qualification conclusion'
 ],
 'https://buy.stripe.com/3cI4gydsL1JReS9err2cg0I'),

('stability-oot', 'Stability OOT Disposition', 'CF09',
 'Who authorized the conclusion that the out-of-trend stability result did not impact product quality or shelf life, on what evidence, and how was that determination justified at the moment of decision?',
 'Stability protocol, executed pull data, an OOT investigation, and a disposition signature.',
 'The authorization logic behind the OOT disposition. Specifically: which evidence supported the no-impact conclusion, which alternative explanations were considered, and which authorized signatory took accountability for the determination that the trend did not signal a quality concern.',
 'Failure to document the rationale used to justify the conclusion that the out-of-trend stability result did not indicate a product quality issue or warrant a change in expiry date, including the specific evidence reviewed and the basis on which alternative explanations were excluded. The stability disposition record establishes that the OOT was investigated but does not reconstruct the decision logic that produced the conclusion.',
 ARRAY[
   'Authorized signatory accountable for the OOT disposition',
   'Specific evidence supporting no impact to quality or shelf life',
   'Alternative explanations considered and excluded, with rationale',
   'Regulatory framework cited (ICH Q1A, Q1E, 21 CFR 211.166)',
   'Timestamped authorization separate from data trending',
   'Decision logic linking evidence to disposition conclusion'
 ],
 'https://buy.stripe.com/9B6eVcbkD6079xP4QR2cg0J'),

('complaint-investigation', 'Complaint Investigation Disposition', 'CF10',
 'Who authorized the conclusion that the complaint did not require regulatory reporting or product action, on what evidence, and how was that determination justified at the moment of decision?',
 'A complaint record, an investigation report, a root cause analysis, and a closure signature.',
 'The authorization logic behind the complaint disposition. Specifically: which evidence supported the no-action conclusion, how reportability was evaluated against MDR or vigilance criteria, and which authorized signatory took accountability for the determination.',
 'Failure to document the rationale used to justify the conclusion that the complaint did not require regulatory reporting or further product action, including the specific evidence reviewed and the basis on which reportability criteria were evaluated. The complaint closure record establishes that the complaint was investigated but does not reconstruct the decision logic that produced the disposition.',
 ARRAY[
   'Authorized signatory accountable for the complaint disposition',
   'Specific evidence supporting no further action',
   'Reportability evaluation against applicable criteria, with rationale',
   'Regulatory framework cited (21 CFR 211.198, 803, EU GVP Module VI)',
   'Timestamped authorization separate from complaint receipt',
   'Decision logic linking evidence to disposition conclusion'
 ],
 'https://buy.stripe.com/7sYaEWewPewD8tL3MN2cg0K');

SELECT case_file_slug, scenario_name FROM exposure_snapshots ORDER BY case_file_id;
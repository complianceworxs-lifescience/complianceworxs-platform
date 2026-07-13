// case-file-render v1 — Unified renderer for all case file pages
// Routes:
//   GET /functions/v1/case-file-render?slug=<slug>&role=part1
//   GET /functions/v1/case-file-render?slug=<slug>&role=part2
//   GET /functions/v1/case-file-render?slug=<slug>&role=part3
//   GET /functions/v1/case-file-render?slug=<slug>&role=template
//
// Pulls scenario data from exposure_snapshots table.
// Returns fully-rendered HTML with proper Content-Type.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface Scenario {
  case_file_slug: string;
  public_slug: string;
  scenario_name: string;
  case_file_id: string;
  subspec: string;
  citation_primary: string;
  citation_ich: string;
  regulatory_framework: string;
  inspector_question: string;
  scene_para_1: string;
  scene_para_2: string;
  inspector_short_quote: string;
  inspector_long_quote: string;
  inspector_quote_3: string;
  investigator_role: string;
  decision_subject: string;
  narrative2_lead: string;
  narrative2_para1: string;
  narrative2_para4: string;
  eval_headline: string;
  eval_p1: string;
  eval_p2: string;
  eval_p3: string;
  anchor_text: string;
  gap_h2: string;
  gap_list: string[];
  gap_emphasis: string;
  observation_language: string;
  field_1_name: string; field_1_desc: string;
  field_2_name: string; field_2_desc: string;
  field_3_name: string; field_3_desc: string;
  field_4_name: string; field_4_desc: string;
  field_5_name: string; field_5_desc: string;
  ddr_record_id: string;
  ddr_decision: string;
  ddr_authorizer: string;
  ddr_authority_basis: string;
  ddr_evidence_list: string;
  ddr_alternatives: string;
  ddr_timestamp: string;
  case_file_stripe_url: string;
  product_lot_example: string;
  report_id_example: string;
}

const BUNDLE_LINK = 'https://buy.stripe.com/fZu5kC9cv4W3dO5dnn2cg0P';

const SHARED_HEAD = (title: string, description: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="stylesheet" href="/global.css">
<script src="/js/case-file-automation.js" defer></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --teal: #0E6F86; --teal-dark: #0A5F74; --navy: #0A2540; --navy-deep: #061829;
  --gold: #F7C51E; --orange: #C2410C; --orange-bright: #D86A2B;
  --text: #0A0A0A; --text-soft: #4A4A4A; --muted: #6B7280;
  --bg: #FFFFFF; --surface: #F5F5F5; --border: #E5E7EB; --green: #15803D;
}
html { scroll-behavior: smooth; }
body { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; font-size: 17px; }
.progress-bar { background: var(--navy); color: #FFFFFF; padding: 10px 24px; text-align: center; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; position: sticky; top: 0; z-index: 100; }
.progress-bar .step { opacity: 0.5; } .progress-bar .step.active { opacity: 1; color: var(--gold); } .progress-bar .step.done { opacity: 0.7; color: rgba(255,255,255,0.7); } .progress-bar .arrow { margin: 0 8px; opacity: 0.4; }
.cw-header { background: var(--bg); border-bottom: 1px solid var(--border); padding: 14px 24px; }
.cw-header-inner { max-width: 880px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
.cw-logo { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.20em; text-transform: uppercase; color: var(--navy); font-weight: 700; text-decoration: none; }
.cw-back { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); text-decoration: none; }
.cw-back:hover { color: var(--teal); }
.btn-primary { display: inline-block; background: linear-gradient(90deg, var(--gold) 0%, var(--orange-bright) 100%); color: #FFFFFF !important; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 0.04em; padding: 18px 36px; text-decoration: none; border-radius: 4px; box-shadow: 0 4px 14px rgba(216,106,43,0.35); transition: transform 0.1s, opacity 0.12s; line-height: 1.2; white-space: nowrap; }
.btn-primary:hover { opacity: 0.94; transform: translateY(-1px); }
.btn-primary.large { font-size: 17px; padding: 22px 44px; box-shadow: 0 6px 20px rgba(216,106,43,0.45); }
.cw-footer { background: var(--bg); border-top: 1px solid var(--border); padding: 28px 24px; text-align: center; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.14em; color: var(--muted); text-transform: uppercase; }
</style>`;

function renderPart1(s: Scenario): string {
  const head = SHARED_HEAD(
    `${s.scenario_name}: The 483 Most Teams Don't See Coming | ComplianceWorxs`,
    `${s.observation_language.slice(0, 150)}...`
  );

  const gapListHtml = s.gap_list.map(item => `      <li>${item}</li>`).join('\n');

  return `${head}
<style>
.hero { background: var(--bg); padding: 64px 24px 56px; border-bottom: 1px solid var(--border); }
.hero-inner { max-width: 760px; margin: 0 auto; }
.hero-eyebrow { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 24px; }
.hero-title { font-family: Georgia, 'Times New Roman', serif; font-size: 44px; font-weight: 400; color: var(--navy); line-height: 1.18; margin-bottom: 20px; letter-spacing: -0.018em; }
.hero-sub { font-size: 19px; color: var(--text); line-height: 1.55; max-width: 680px; margin-bottom: 28px; }
.hero-sub strong { color: var(--navy); font-weight: 700; }
.hero-deliverables { background: var(--surface); border-left: 3px solid var(--teal); padding: 20px 24px; margin-bottom: 32px; }
.hero-deliverables-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.20em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 10px; }
.hero-deliverables ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; }
.hero-deliverables li { font-size: 14px; color: var(--text); padding-left: 20px; position: relative; line-height: 1.5; }
.hero-deliverables li::before { content: "✓"; position: absolute; left: 0; color: var(--green); font-weight: 700; }
.hero-cta-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-bottom: 16px; }
.hero-trust { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.10em; color: var(--muted); line-height: 1.6; }
.hero-trust strong { color: var(--navy); font-weight: 700; }
.hero-meta { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 28px; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.10em; color: var(--muted); text-transform: uppercase; }
.hero-meta strong { color: var(--navy); font-weight: 700; }
.narrative { background: var(--bg); padding: 64px 24px; }
.narrative-inner { max-width: 720px; margin: 0 auto; }
.narrative-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 18px; }
.narrative-title { font-family: Georgia, serif; font-size: 30px; font-weight: 400; color: var(--navy); line-height: 1.25; margin-bottom: 24px; letter-spacing: -0.01em; }
.narrative p { font-size: 18px; line-height: 1.75; color: var(--text); margin-bottom: 16px; max-width: 680px; }
.narrative p strong { font-weight: 700; }
.narrative p em { color: var(--teal-dark); font-style: italic; font-weight: 500; }
.inspector { background: var(--navy); padding: 72px 24px; border-top: 4px solid var(--orange); }
.inspector-inner { max-width: 720px; margin: 0 auto; }
.inspector-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--orange-bright); font-weight: 700; margin-bottom: 22px; display: flex; align-items: center; gap: 14px; }
.inspector-label::before { content: ""; display: inline-block; width: 32px; height: 1px; background: var(--orange-bright); }
.inspector-quote { font-family: Georgia, serif; font-size: 30px; font-weight: 400; line-height: 1.35; color: #FFFFFF; letter-spacing: -0.01em; margin-bottom: 24px; }
.inspector-quote.short { font-size: 38px; font-style: italic; }
.inspector-followup { font-size: 16px; color: rgba(255,255,255,0.72); line-height: 1.6; max-width: 560px; border-left: 2px solid var(--orange); padding-left: 18px; }
.relief { background: var(--surface); padding: 56px 24px; text-align: center; border-bottom: 1px solid var(--border); }
.relief-inner { max-width: 640px; margin: 0 auto; }
.relief-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 16px; }
.relief-statement { font-family: Georgia, serif; font-size: 22px; color: var(--navy); line-height: 1.5; font-weight: 400; margin-bottom: 24px; max-width: 580px; margin-left: auto; margin-right: auto; }
.relief-statement strong { color: var(--navy); font-weight: 700; }
.relief-cta { font-family: 'Courier New', monospace; font-size: 12px; color: var(--teal); text-decoration: none; letter-spacing: 0.10em; text-transform: uppercase; border-bottom: 1px solid var(--teal); padding-bottom: 2px; }
.relief-cta:hover { color: var(--orange); border-color: var(--orange); }
.eval-box { background: var(--surface); border: 1px solid var(--border); padding: 26px 30px; margin: 28px 0 0; border-radius: 2px; }
.eval-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--navy); font-weight: 700; margin-bottom: 14px; }
.eval-headline { font-family: Georgia, serif; font-size: 19px; color: var(--navy); line-height: 1.45; margin-bottom: 14px; font-weight: 600; }
.eval-body { font-size: 16px !important; line-height: 1.75 !important; color: var(--text); margin-bottom: 12px !important; }
.eval-body:last-child { margin-bottom: 0 !important; }
.anchor { background: var(--navy-deep); padding: 36px 24px; text-align: center; color: #FFFFFF; }
.anchor-inner { max-width: 640px; margin: 0 auto; }
.anchor-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 12px; }
.anchor-text { font-size: 17px; line-height: 1.55; color: #FFFFFF; opacity: 0.88; }
.anchor-text strong { color: var(--gold); font-weight: 700; opacity: 1; }
.gap-block { background: var(--bg); padding: 88px 24px; text-align: center; }
.gap-inner { max-width: 640px; margin: 0 auto; }
.gap-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.30em; text-transform: uppercase; color: var(--orange); font-weight: 700; margin-bottom: 24px; }
.gap-title { font-family: Georgia, serif; font-size: 36px; font-weight: 400; color: var(--navy); line-height: 1.25; margin-bottom: 28px; letter-spacing: -0.015em; }
.gap-list { list-style: none; margin: 28px auto; padding: 0; max-width: 580px; text-align: left; }
.gap-list li { font-size: 17px; line-height: 1.65; color: var(--text); padding: 14px 0; border-bottom: 1px solid var(--border); padding-left: 28px; position: relative; }
.gap-list li:last-child { border-bottom: none; }
.gap-list li::before { content: "✕"; position: absolute; left: 0; color: var(--orange); font-weight: 700; font-size: 14px; top: 16px; }
.gap-emphasis { font-family: Georgia, serif; font-size: 22px; line-height: 1.5; color: var(--text); font-weight: 600; margin: 32px auto 36px; max-width: 600px; }
.gap-emphasis em { color: var(--orange); font-style: normal; font-weight: 700; }
.gap-mid-cta { margin-top: 32px; padding-top: 28px; border-top: 1px solid var(--border); }
.gap-mid-cta-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.20em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
.gap-mid-cta-link { font-family: Georgia, serif; font-size: 18px; color: var(--teal-dark); text-decoration: none; border-bottom: 2px solid var(--gold); padding-bottom: 3px; font-weight: 600; }
.gap-mid-cta-link:hover { color: var(--orange); border-color: var(--orange); }
.cta-block { background: var(--navy); padding: 96px 24px; text-align: center; border-top: 4px solid var(--orange); }
.cta-inner { max-width: 640px; margin: 0 auto; }
.cta-eyebrow { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 22px; }
.cta-bridge { font-family: Georgia, serif; font-size: 18px; color: var(--gold); line-height: 1.5; margin-bottom: 18px; font-style: italic; max-width: 540px; margin-left: auto; margin-right: auto; }
.cta-headline { font-family: Georgia, serif; font-size: 36px; font-weight: 400; line-height: 1.25; margin-bottom: 22px; color: #FFFFFF !important; letter-spacing: -0.015em; }
.cta-sub { font-size: 17px !important; color: #FFFFFF !important; opacity: 0.85; line-height: 1.6 !important; margin: 0 auto 36px; max-width: 500px; }
.cta-meta { margin-top: 22px; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.14em; color: rgba(255,255,255,0.55); text-transform: uppercase; }
.cta-meta strong { color: var(--green); font-weight: 700; }
.cta-trust { margin-top: 28px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.12); font-size: 13px; color: rgba(255,255,255,0.6); line-height: 1.6; max-width: 500px; margin-left: auto; margin-right: auto; }
@media (max-width: 640px) {
  .progress-bar { font-size: 9px; padding: 9px 16px; letter-spacing: 0.12em; }
  .hero { padding: 44px 22px 40px; } .hero-title { font-size: 30px; } .hero-sub { font-size: 17px; }
  .hero-deliverables ul { grid-template-columns: 1fr; }
  .hero-cta-row { flex-direction: column; align-items: flex-start; }
  .narrative { padding: 48px 22px; } .narrative-title { font-size: 24px; } .narrative p { font-size: 17px; }
  .inspector { padding: 56px 22px; } .inspector-quote { font-size: 23px; } .inspector-quote.short { font-size: 27px; }
  .relief { padding: 44px 22px; } .relief-statement { font-size: 18px; }
  .anchor { padding: 28px 22px; } .anchor-text { font-size: 15px; }
  .gap-block { padding: 56px 22px; } .gap-title { font-size: 26px; } .gap-emphasis { font-size: 18px; }
  .cta-block { padding: 64px 22px; } .cta-headline { font-size: 26px; }
  .btn-primary.large { width: 100%; text-align: center; padding: 20px 24px; }
}
</style>
</head>
<body>
<div class="progress-bar"><span class="step active">Part 01 · The Question</span><span class="arrow">→</span><span class="step">Part 02 · The Record</span><span class="arrow">→</span><span class="step">Part 03 · The File</span></div>
<header class="cw-header"><div class="cw-header-inner"><a href="https://complianceworxs.com" class="cw-logo">ComplianceWorxs</a><a href="https://complianceworxs.com/case-files" class="cw-back">← All Case Files</a></div></header>

<section class="hero"><div class="hero-inner">
<div class="hero-eyebrow">Inspection Case File · ${s.case_file_id} · ${s.subspec}</div>
<h1 class="hero-title">${s.scenario_name}: The 483 Most Teams Don't See Coming.</h1>
<p class="hero-sub">${s.what_file_likely_shows ? `${s.what_file_likely_shows} <strong>And a single question, asked on day two of inspection, that the file does not answer.</strong>` : ''}</p>
<div class="hero-deliverables"><div class="hero-deliverables-label">What you'll see in this case file</div><ul><li>The exact 483 observation language</li><li>The five required authorization fields</li><li>A complete reference DDR record</li><li>The blank template for your facility</li></ul></div>
<div class="hero-cta-row"><a href="/${s.public_slug}/authorization-record" class="btn-primary">See What Defensible Looks Like →</a><span class="hero-trust"><strong>Free to read.</strong> No payment to continue.</span></div>
<div class="hero-meta"><span>Citation · <strong>${s.citation_primary}</strong></span><span>ICH · <strong>${s.citation_ich}</strong></span><span>Used by Quality leaders preparing for <strong>FDA inspections</strong></span></div>
</div></section>

<section class="narrative"><div class="narrative-inner">
<div class="narrative-label">The Scene</div>
<h2 class="narrative-title">${s.scene_para_1.split('. ')[0]}.</h2>
<p>${s.scene_para_1.split('. ').slice(1).join('. ')}</p>
<p>${s.scene_para_2}</p>
<p>The investigator turns to the conclusion.</p>
</div></section>

<section class="inspector"><div class="inspector-inner">
<div class="inspector-label">Investigator</div>
<div class="inspector-quote short">"${s.inspector_short_quote}"</div>
<div class="inspector-followup">She reads the conclusion. Then she sets the file down and looks up.</div>
</div></section>

<section class="inspector"><div class="inspector-inner">
<div class="inspector-label">Investigator</div>
<div class="inspector-quote">"${s.inspector_long_quote}"</div>
<div class="inspector-followup">She listens to the verbal answer. Then she asks for the documented reasoning.</div>
</div></section>

<section class="relief"><div class="relief-inner">
<div class="relief-label">Pause</div>
<p class="relief-statement"><strong>Most teams answer this question verbally.</strong> The file does not contain the documented reasoning. That is the gap.</p>
<a href="/${s.public_slug}/authorization-record" class="relief-cta">Skip ahead to the record format →</a>
</div></section>

<section class="anchor"><div class="anchor-inner">
<div class="anchor-label">Why this matters now</div>
<p class="anchor-text">${s.anchor_text}</p>
</div></section>

<section class="narrative"><div class="narrative-inner">
<div class="narrative-label">What the file contained</div>
<h2 class="narrative-title">${s.narrative2_lead}</h2>
<p>${s.narrative2_para1}</p>
<p>What the file <em>contained</em> was the conclusion.</p>
<p>What the file did not contain was the decision.</p>
<p>${s.narrative2_para4}</p>
<p><strong>The conclusion belongs in the file. The decision belongs in the record.</strong></p>
<div class="eval-box">
<div class="eval-label">What the investigator is evaluating</div>
<div class="eval-headline">${s.eval_headline}</div>
<p class="eval-body">${s.eval_p1}</p>
<p class="eval-body">${s.eval_p2}</p>
<p class="eval-body">${s.eval_p3}</p>
</div>
</div></section>

<section class="inspector"><div class="inspector-inner">
<div class="inspector-label">Investigator</div>
<div class="inspector-quote">"${s.inspector_quote_3}"</div>
<div class="inspector-followup">The ${s.investigator_role} cannot produce the record.</div>
</div></section>

<section class="gap-block"><div class="gap-inner">
<div class="gap-label">The Gap</div>
<h2 class="gap-title">${s.gap_h2}</h2>
<ul class="gap-list">
${gapListHtml}
</ul>
<p class="gap-emphasis">${s.gap_emphasis}</p>
<div class="gap-mid-cta"><div class="gap-mid-cta-label">Ready to see the record format?</div><a href="/${s.public_slug}/authorization-record" class="gap-mid-cta-link">See the five fields the investigator expects to find →</a></div>
</div></section>

<section class="inspector"><div class="inspector-inner">
<div class="inspector-label">The 483</div>
<div class="inspector-quote">"${s.observation_language}"</div>
<div class="inspector-followup">${s.citation_primary} — applied regulatory framework.</div>
</div></section>

<div class="cta-block"><div class="cta-inner">
<div class="cta-eyebrow">Continued · Part 02 of 03</div>
<p class="cta-bridge">That 483 was avoidable.</p>
<h2 class="cta-headline">See the record that prevents it.</h2>
<p class="cta-sub">The five fields the investigator expects to find. The alternative-causes evaluation that distinguishes a decision from a signature. A complete reference example.</p>
<a href="/${s.public_slug}/authorization-record" class="btn-primary large">Show Me the Record →</a>
<div class="cta-meta"><strong>✓ Free to read</strong>  ·  No payment required to continue</div>
<p class="cta-trust">Used by Quality and Validation leaders preparing for FDA and EMA inspections. Built around <strong>${s.regulatory_framework}</strong>.</p>
</div></div>

<footer class="cw-footer">ComplianceWorxs · Inspection Case File ${s.case_file_id} · ${s.citation_primary}</footer>
</body></html>`;
}

function renderPart2(s: Scenario): string {
  const head = SHARED_HEAD(
    `The Authorization Record: Five Required Fields for ${s.scenario_name} Defense | ComplianceWorxs`,
    `The five fields the FDA investigator expects to find. The alternative-causes evaluation that distinguishes a decision from a signature.`
  );
  return `${head}
<style>
.hero { background: var(--bg); padding: 64px 24px 48px; border-bottom: 1px solid var(--border); }
.hero-inner { max-width: 760px; margin: 0 auto; }
.hero-eyebrow { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 22px; }
.hero-title { font-family: Georgia, serif; font-size: 42px; font-weight: 400; color: var(--navy); line-height: 1.18; margin-bottom: 20px; letter-spacing: -0.018em; }
.hero-sub { font-size: 19px; color: var(--text); line-height: 1.55; max-width: 680px; margin-bottom: 28px; }
.hero-sub strong { color: var(--navy); font-weight: 700; }
.hero-cta-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
.hero-trust { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.10em; color: var(--muted); }
.hero-trust strong { color: var(--navy); font-weight: 700; }
.narrative { background: var(--bg); padding: 64px 24px; }
.narrative-inner { max-width: 720px; margin: 0 auto; }
.narrative-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 18px; }
.narrative-title { font-family: Georgia, serif; font-size: 30px; font-weight: 400; color: var(--navy); line-height: 1.25; margin-bottom: 24px; }
.narrative p { font-size: 18px; line-height: 1.75; color: var(--text); margin-bottom: 16px; max-width: 680px; }
.narrative p strong { font-weight: 700; }
.inspector { background: var(--navy); padding: 72px 24px; border-top: 4px solid var(--orange); }
.inspector-inner { max-width: 720px; margin: 0 auto; }
.inspector-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--orange-bright); font-weight: 700; margin-bottom: 22px; display: flex; align-items: center; gap: 14px; }
.inspector-label::before { content: ""; display: inline-block; width: 32px; height: 1px; background: var(--orange-bright); }
.inspector-quote { font-family: Georgia, serif; font-size: 30px; font-weight: 400; line-height: 1.35; color: #FFFFFF; margin-bottom: 24px; }
.inspector-followup { font-size: 16px; color: rgba(255,255,255,0.72); line-height: 1.6; max-width: 560px; border-left: 2px solid var(--orange); padding-left: 18px; }
.fields-section { background: var(--bg); padding: 80px 24px; }
.fields-inner { max-width: 760px; margin: 0 auto; }
.fields-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 18px; text-align: center; }
.fields-title { font-family: Georgia, serif; font-size: 36px; font-weight: 400; color: var(--navy); line-height: 1.22; margin-bottom: 18px; text-align: center; }
.fields-intro { font-size: 18px; line-height: 1.6; color: var(--text); margin: 0 auto 48px; max-width: 620px; text-align: center; }
.fields-list { list-style: none; padding: 0; margin: 0; }
.field-card { background: #FFFFFF; border: 1px solid var(--border); border-left: 4px solid var(--teal); padding: 28px 32px; margin-bottom: 16px; display: grid; grid-template-columns: 64px 1fr; gap: 24px; }
.field-card.critical { border-left-color: var(--orange); background: #FFFAF5; }
.field-num { font-family: 'Courier New', monospace; font-size: 32px; font-weight: 700; color: var(--teal); line-height: 1; padding-top: 4px; }
.field-card.critical .field-num { color: var(--orange); }
.field-name { font-family: Georgia, serif; font-size: 20px; color: var(--navy); margin-bottom: 10px; font-weight: 600; line-height: 1.3; }
.field-desc { font-size: 15.5px; color: var(--text); line-height: 1.65; }
.field-flag { display: inline-block; background: var(--orange); color: #FFFFFF; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; padding: 3px 8px; margin-left: 10px; vertical-align: middle; font-weight: 700; border-radius: 2px; }
.field-spotlight { background: var(--navy); color: #FFFFFF; padding: 56px 24px; margin-top: 48px; }
.field-spotlight-inner { max-width: 640px; margin: 0 auto; }
.field-spotlight-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--orange-bright); font-weight: 700; margin-bottom: 20px; }
.field-spotlight-title { font-family: Georgia, serif; font-size: 26px; line-height: 1.35; margin-bottom: 20px; color: #FFFFFF; }
.field-spotlight-body { font-size: 16px; line-height: 1.7; color: rgba(255,255,255,0.85); margin-bottom: 14px; }
.field-spotlight-body strong { color: var(--gold); font-weight: 700; }
.anchor { background: var(--navy-deep); padding: 36px 24px; text-align: center; color: #FFFFFF; }
.anchor-inner { max-width: 640px; margin: 0 auto; }
.anchor-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 12px; }
.anchor-text { font-size: 17px; line-height: 1.55; color: #FFFFFF; opacity: 0.88; }
.anchor-text strong { color: var(--gold); font-weight: 700; opacity: 1; }
.example-section { background: var(--surface); padding: 72px 24px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.example-inner { max-width: 760px; margin: 0 auto; }
.example-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 18px; text-align: center; }
.example-title { font-family: Georgia, serif; font-size: 30px; font-weight: 400; color: var(--navy); line-height: 1.25; margin-bottom: 16px; text-align: center; }
.example-intro { font-size: 17px; line-height: 1.6; color: var(--text); margin: 0 auto 36px; max-width: 560px; text-align: center; }
.example-doc { background: #FFFFFF; border: 1px solid var(--border); }
.example-doc-header { background: var(--navy); color: #FFFFFF; padding: 22px 28px; }
.example-doc-eyebrow { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); margin-bottom: 6px; }
.example-doc-title { font-family: Georgia, serif; font-size: 19px; color: #FFFFFF; line-height: 1.3; }
.example-doc-body { padding: 28px; }
.example-row { display: grid; grid-template-columns: 200px 1fr; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); font-size: 14.5px; }
.example-row:last-child { border-bottom: none; }
.example-key { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.10em; text-transform: uppercase; color: var(--muted); padding-top: 3px; }
.example-val { color: var(--navy); line-height: 1.6; }
.example-cont { text-align: center; padding: 20px; background: #FFFFFF; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.18em; color: var(--muted); text-transform: uppercase; }
.cta-block { background: var(--navy); padding: 96px 24px; text-align: center; border-top: 4px solid var(--orange); }
.cta-inner { max-width: 640px; margin: 0 auto; }
.cta-eyebrow { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 22px; }
.cta-bridge { font-family: Georgia, serif; font-size: 18px; color: var(--gold); line-height: 1.5; margin-bottom: 18px; font-style: italic; max-width: 540px; margin-left: auto; margin-right: auto; }
.cta-headline { font-family: Georgia, serif; font-size: 36px; font-weight: 400; line-height: 1.25; margin-bottom: 22px; color: #FFFFFF !important; }
.cta-sub { font-size: 17px !important; color: #FFFFFF !important; opacity: 0.85; line-height: 1.6 !important; margin: 0 auto 36px; max-width: 500px; }
.cta-meta { margin-top: 22px; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.14em; color: rgba(255,255,255,0.55); text-transform: uppercase; }
.cta-meta strong { color: var(--green); font-weight: 700; }
.cta-trust { margin-top: 28px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.12); font-size: 13px; color: rgba(255,255,255,0.6); line-height: 1.6; max-width: 500px; margin: 28px auto 0; }
@media (max-width: 640px) {
  .hero-title { font-size: 28px; } .field-card { grid-template-columns: 44px 1fr; padding: 22px 24px; gap: 16px; } .field-num { font-size: 24px; } .example-row { grid-template-columns: 1fr; gap: 4px; } .cta-headline { font-size: 26px; }
}
</style>
</head>
<body>
<div class="progress-bar"><span class="step done">Part 01 · The Question</span><span class="arrow">→</span><span class="step active">Part 02 · The Record</span><span class="arrow">→</span><span class="step">Part 03 · The File</span></div>
<header class="cw-header"><div class="cw-header-inner"><a href="https://complianceworxs.com" class="cw-logo">ComplianceWorxs</a><a href="/${s.public_slug}" class="cw-back">← Part 01</a></div></header>

<section class="hero"><div class="hero-inner">
<div class="hero-eyebrow">Inspection Case File · ${s.case_file_id} · Part 02 of 03</div>
<h1 class="hero-title">The five fields the FDA investigator expects to find — and the one most files don't have.</h1>
<p class="hero-sub">A ${s.scenario_name.toLowerCase()} with a signature is not the same as one with a documented decision. <strong>The investigator can tell the difference in thirty seconds.</strong></p>
<div class="hero-cta-row"><a href="/${s.public_slug}/complete-file" class="btn-primary">See the Complete File →</a><span class="hero-trust"><strong>Free to read.</strong> Buy decision is on the next page.</span></div>
</div></section>

<section class="narrative"><div class="narrative-inner">
<div class="narrative-label">What separates a decision from a signature</div>
<h2 class="narrative-title">A signature on a closure form proves that a person signed. It does not prove what they decided.</h2>
<p>Under inspection, a signature is evidence of an event. It is not evidence of a decision. The investigator does not doubt the signature. She doubts that anything was decided.</p>
<p>An authorization record is structured to be evidence of a decision. It names the person, the moment, the evidence reviewed, the alternatives evaluated, and the basis on which the conclusion was reached. <strong>The record answers.</strong></p>
</div></section>

<section class="inspector"><div class="inspector-inner">
<div class="inspector-label">Investigator</div>
<div class="inspector-quote">"${s.inspector_question}"</div>
<div class="inspector-followup">This is the question that requires Field 03 of the authorization record to exist.</div>
</div></section>

<section class="fields-section"><div class="fields-inner">
<div class="fields-label">The Authorization Record · Required Structure</div>
<h2 class="fields-title">Five fields. Missing any one is the gap a 483 cites.</h2>
<p class="fields-intro">Every authorization record for this scenario must contain the following five fields. The third field is the one that is almost always missing.</p>
<ol class="fields-list">
<li class="field-card"><div class="field-num">01</div><div><div class="field-name">${s.field_1_name}</div><div class="field-desc">${s.field_1_desc}</div></div></li>
<li class="field-card"><div class="field-num">02</div><div><div class="field-name">${s.field_2_name}</div><div class="field-desc">${s.field_2_desc}</div></div></li>
<li class="field-card critical"><div class="field-num">03</div><div><div class="field-name">${s.field_3_name}<span class="field-flag">Most Often Missing</span></div><div class="field-desc">${s.field_3_desc}</div></div></li>
<li class="field-card"><div class="field-num">04</div><div><div class="field-name">${s.field_4_name}</div><div class="field-desc">${s.field_4_desc}</div></div></li>
<li class="field-card"><div class="field-num">05</div><div><div class="field-name">${s.field_5_name}</div><div class="field-desc">${s.field_5_desc}</div></div></li>
</ol>
<div class="field-spotlight"><div class="field-spotlight-inner">
<div class="field-spotlight-label">Why Field 03 matters most</div>
<h3 class="field-spotlight-title">A file almost never contains a documented alternative-causes evaluation. The investigator opens to it first.</h3>
<p class="field-spotlight-body">Most investigations conclude with a single root cause. They rarely document the alternatives that were evaluated and eliminated to arrive there. The investigator knows this. <strong>It is the field she opens to first.</strong></p>
<p class="field-spotlight-body"><strong>An authorization record without a documented alternative-causes evaluation is not an authorization record. It is a signature on a conclusion.</strong></p>
</div></div>
</div></section>

<section class="anchor"><div class="anchor-inner">
<div class="anchor-label">Why this matters now</div>
<p class="anchor-text">The five-field structure is the same whether the inspection is <strong>this quarter or next year</strong>. The difference is whether you build the record now — when you have time, evidence, and the original decision-maker available — or under inspection pressure when none of those are guaranteed.</p>
</div></section>

<section class="example-section"><div class="example-inner">
<div class="example-label">Reference Example</div>
<h2 class="example-title">${s.ddr_record_id} — ${s.product_lot_example.split(',')[0].trim()}</h2>
<p class="example-intro">The same scenario from Part 01, with the authorization record that should have existed in the file. Excerpt from the complete reference DDR.</p>
<div class="example-doc">
<div class="example-doc-header">
<div class="example-doc-eyebrow">Decision Defense Record · ${s.ddr_record_id} · Excerpt</div>
<div class="example-doc-title">${s.scenario_name} — ${s.report_id_example}</div>
</div>
<div class="example-doc-body">
<div class="example-row"><div class="example-key">Decision Authorized</div><div class="example-val">${s.ddr_decision}</div></div>
<div class="example-row"><div class="example-key">Authorizing Individual</div><div class="example-val">${s.ddr_authorizer}</div></div>
<div class="example-row"><div class="example-key">Authority Basis</div><div class="example-val">${s.ddr_authority_basis}</div></div>
<div class="example-row"><div class="example-key">Evidence Reviewed</div><div class="example-val">${s.ddr_evidence_list}</div></div>
<div class="example-row"><div class="example-key">Alternatives Eliminated</div><div class="example-val">${s.ddr_alternatives}</div></div>
<div class="example-row"><div class="example-key">Authorization Timestamp</div><div class="example-val">${s.ddr_timestamp}</div></div>
<div class="example-row"><div class="example-key">Regulatory Framework</div><div class="example-val">${s.regulatory_framework}</div></div>
</div>
<div class="example-cont">— Continued in the complete file —</div>
</div>
</div></section>

<div class="cta-block"><div class="cta-inner">
<div class="cta-eyebrow">Continued · Part 03 of 03</div>
<p class="cta-bridge">The structure is clear. The example is published. The record itself is in the complete file.</p>
<h2 class="cta-headline">See the complete authorization record.</h2>
<p class="cta-sub">A completed reference DDR. The blank template applied to your facility. The evidence checklist that closes the gap before inspection begins.</p>
<a href="/${s.public_slug}/complete-file" class="btn-primary large">Show Me the Complete File →</a>
<div class="cta-meta"><strong>✓ Free to read</strong>  ·  Three commitment levels available</div>
<p class="cta-trust">Used by Quality and Validation leaders preparing for FDA and EMA inspections. Built around <strong>${s.regulatory_framework}</strong>.</p>
</div></div>

<footer class="cw-footer">ComplianceWorxs · Inspection Case File ${s.case_file_id} · ${s.citation_primary}</footer>
</body></html>`;
}

function renderPart3(s: Scenario): string {
  const head = SHARED_HEAD(
    `The Complete File: ${s.scenario_name} Record | ComplianceWorxs`,
    `The full authorization record. Free template, complete reference DDR, or full inspection set bundle.`
  );
  return `${head}
<style>
.hero { background: var(--bg); padding: 64px 24px 48px; border-bottom: 1px solid var(--border); }
.hero-inner { max-width: 760px; margin: 0 auto; }
.hero-eyebrow { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 22px; }
.hero-title { font-family: Georgia, serif; font-size: 44px; font-weight: 400; color: var(--navy); line-height: 1.18; margin-bottom: 20px; letter-spacing: -0.018em; }
.hero-sub { font-size: 19px; color: var(--text); line-height: 1.55; max-width: 680px; margin-bottom: 16px; }
.hero-meta { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.10em; color: var(--muted); text-transform: uppercase; }
.hero-meta strong { color: var(--navy); font-weight: 700; }
.recap { background: var(--surface); padding: 36px 24px; border-bottom: 1px solid var(--border); }
.recap-inner { max-width: 720px; margin: 0 auto; }
.recap-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 12px; }
.recap p { font-size: 16px; line-height: 1.65; color: var(--text-soft); margin: 0; }
.recap p strong { color: var(--navy); font-weight: 700; }
.tiers-section { background: var(--bg); padding: 80px 24px; }
.tiers-inner { max-width: 760px; margin: 0 auto; }
.tiers-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 18px; text-align: center; }
.tiers-title { font-family: Georgia, serif; font-size: 36px; font-weight: 400; color: var(--navy); line-height: 1.22; margin-bottom: 20px; text-align: center; }
.tiers-intro { font-size: 17px; line-height: 1.6; color: var(--text); margin: 0 auto 56px; max-width: 580px; text-align: center; }
.tier { background: #FFFFFF; border: 1px solid var(--border); margin-bottom: 24px; overflow: hidden; }
.tier.free-tier { border-left: 4px solid var(--green); }
.tier.primary-tier { border: 2px solid var(--orange); box-shadow: 0 4px 14px rgba(216,106,43,0.15); }
.tier.primary-tier .tier-header { background: #FFFAF5; }
.tier.bundle-tier { border-left: 4px solid var(--gold); }
.tier-header { padding: 32px 36px 24px; border-bottom: 1px solid var(--border); }
.tier-eyebrow-row { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
.tier-step { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.tier-tag { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; padding: 3px 10px; border-radius: 2px; font-weight: 700; }
.tier-tag.free { background: var(--green); color: #FFFFFF; }
.tier-tag.recommended { background: var(--orange); color: #FFFFFF; }
.tier-tag.expansion { background: var(--gold); color: var(--navy); }
.tier-name { font-family: Georgia, serif; font-size: 26px; color: var(--navy); line-height: 1.3; font-weight: 600; margin-bottom: 8px; }
.tier-tagline { font-size: 15px; color: var(--text-soft); line-height: 1.55; }
.tier-body { padding: 28px 36px 32px; }
.tier-body h4 { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.20em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 14px; }
.tier-includes { list-style: none; padding: 0; margin: 0 0 24px; }
.tier-includes li { font-size: 15px; line-height: 1.65; color: var(--text); padding: 8px 0 8px 26px; position: relative; }
.tier-includes li::before { content: "✓"; position: absolute; left: 0; top: 9px; color: var(--green); font-weight: 700; }
.tier-not-included { list-style: none; padding: 0; margin: 0 0 24px; }
.tier-not-included li { font-size: 14px; line-height: 1.6; color: var(--muted); padding: 6px 0 6px 26px; position: relative; }
.tier-not-included li::before { content: "—"; position: absolute; left: 0; top: 6px; color: var(--muted); }
.tier-footer { background: var(--surface); padding: 24px 36px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.tier-price-block { display: flex; align-items: baseline; gap: 12px; }
.tier-price { font-family: Georgia, serif; font-size: 32px; color: var(--navy); font-weight: 600; }
.tier-price.zero { color: var(--green); }
.tier-price-note { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.12em; color: var(--muted); text-transform: uppercase; }
.btn-primary { font-size: 15px; padding: 16px 28px; }
.btn-primary.large { font-size: 16px; padding: 20px 36px; }
.btn-secondary { display: inline-block; background: var(--green); color: #FFFFFF !important; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.04em; padding: 16px 28px; text-decoration: none; border-radius: 4px; }
.btn-tertiary { display: inline-block; background: var(--navy); color: #FFFFFF !important; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 0.04em; padding: 16px 28px; text-decoration: none; border-radius: 4px; }
.risk-reversal { margin-top: 18px; padding: 14px 18px; background: #F0FDF4; border-left: 3px solid var(--green); font-size: 13px; color: var(--text); line-height: 1.55; border-radius: 2px; }
.risk-reversal strong { color: var(--green); font-weight: 700; }
.anchor { background: var(--navy-deep); padding: 36px 24px; text-align: center; color: #FFFFFF; }
.anchor-inner { max-width: 640px; margin: 0 auto; }
.anchor-label { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 12px; }
.anchor-text { font-size: 17px; line-height: 1.55; color: #FFFFFF; opacity: 0.88; }
.anchor-text strong { color: var(--gold); font-weight: 700; opacity: 1; }
.inspector { background: var(--navy); padding: 72px 24px; border-top: 4px solid var(--orange); }
.inspector-inner { max-width: 720px; margin: 0 auto; }
.inspector-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--orange-bright); font-weight: 700; margin-bottom: 22px; display: flex; align-items: center; gap: 14px; }
.inspector-label::before { content: ""; display: inline-block; width: 32px; height: 1px; background: var(--orange-bright); }
.inspector-quote { font-family: Georgia, serif; font-size: 30px; font-weight: 400; line-height: 1.35; color: #FFFFFF; margin-bottom: 24px; }
.inspector-followup { font-size: 16px; color: rgba(255,255,255,0.72); line-height: 1.6; max-width: 560px; border-left: 2px solid var(--orange); padding-left: 18px; }
.faq-section { background: var(--bg); padding: 72px 24px; border-top: 1px solid var(--border); }
.faq-inner { max-width: 720px; margin: 0 auto; }
.faq-label { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 18px; text-align: center; }
.faq-title { font-family: Georgia, serif; font-size: 30px; font-weight: 400; color: var(--navy); line-height: 1.25; margin-bottom: 36px; text-align: center; }
.faq-item { padding: 22px 0; border-bottom: 1px solid var(--border); }
.faq-q { font-family: Georgia, serif; font-size: 18px; color: var(--navy); margin-bottom: 10px; font-weight: 600; line-height: 1.4; }
.faq-a { font-size: 15.5px; color: var(--text); line-height: 1.7; }
.faq-a strong { color: var(--navy); font-weight: 600; }
.final-cta { background: var(--navy); padding: 80px 24px; text-align: center; border-top: 4px solid var(--orange); }
.final-cta-inner { max-width: 640px; margin: 0 auto; }
.final-cta-eyebrow { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 22px; }
.final-cta-headline { font-family: Georgia, serif; font-size: 32px; font-weight: 400; line-height: 1.3; margin-bottom: 32px; color: #FFFFFF !important; }
.final-cta-trust { margin-top: 24px; font-size: 13px; color: rgba(255,255,255,0.6); line-height: 1.6; max-width: 500px; margin: 24px auto 0; }
.final-cta-trust strong { color: var(--gold); }
@media (max-width: 640px) {
  .hero-title { font-size: 28px; } .tiers-title { font-size: 26px; } .tier-header { padding: 24px 24px 18px; } .tier-name { font-size: 22px; } .tier-body { padding: 22px 24px; } .tier-footer { padding: 20px 24px; flex-direction: column; align-items: flex-start; } .btn-primary, .btn-secondary, .btn-tertiary { width: 100%; text-align: center; padding: 18px 24px; } .final-cta-headline { font-size: 24px; }
}
</style>
</head>
<body>
<div class="progress-bar"><span class="step done">Part 01 · The Question</span><span class="arrow">→</span><span class="step done">Part 02 · The Record</span><span class="arrow">→</span><span class="step active">Part 03 · The File</span></div>
<header class="cw-header"><div class="cw-header-inner"><a href="https://complianceworxs.com" class="cw-logo">ComplianceWorxs</a><a href="/${s.public_slug}/authorization-record" class="cw-back">← Part 02</a></div></header>

<section class="hero"><div class="hero-inner">
<div class="hero-eyebrow">Inspection Case File · ${s.case_file_id} · Part 03 of 03</div>
<h1 class="hero-title">Three ways to close the gap. Start with the lowest commitment.</h1>
<p class="hero-sub">A free template to see the structure. The complete case file when you're ready to produce a defensible record. The full inspection set if this isn't isolated.</p>
<div class="hero-meta">Built around <strong>${s.citation_primary}</strong> · <strong>${s.citation_ich}</strong> · Used by Quality and Validation leaders preparing for FDA and EMA inspections</div>
</div></section>

<section class="recap"><div class="recap-inner">
<div class="recap-label">Where this leaves you</div>
<p>You've seen the inspector's question, the gap in the file, the five required fields, and the reference DDR excerpt. <strong>The structure is no longer a mystery. The decision now is what to put in your facility's records.</strong></p>
</div></section>

<section class="tiers-section"><div class="tiers-inner">
<div class="tiers-label">The Complete File</div>
<h2 class="tiers-title">Three escalating levels. Each builds on the last.</h2>
<p class="tiers-intro">If you're not certain this applies to your facility yet, start with the free template. If you are, the complete case file is the next step. If this isn't isolated to one decision, the full inspection set covers all ten scenarios.</p>

<div class="tier free-tier">
<div class="tier-header">
<div class="tier-eyebrow-row"><span class="tier-step">Start Here · Step 01 of 03</span><span class="tier-tag free">Free</span></div>
<div class="tier-name">The Blank DDR Template</div>
<div class="tier-tagline">The five-field authorization record structure as a blank document. Apply to your facility's data.</div>
</div>
<div class="tier-body">
<h4>What's Included</h4>
<ul class="tier-includes">
<li>The seven-section blank Decision Defense Record template</li>
<li>Field-level guidance on what each section requires</li>
<li>${s.citation_primary} citation header</li>
<li>Print-to-PDF formatted for controlled record use</li>
</ul>
<h4>Not Included at This Level</h4>
<ul class="tier-not-included">
<li>The completed reference DDR</li>
<li>The evidence checklist</li>
<li>The 483 observation reference language</li>
</ul>
</div>
<div class="tier-footer">
<div class="tier-price-block"><span class="tier-price zero">$0</span><span class="tier-price-note">Email delivery · No card required</span></div>
<a href="#free-template-form" class="btn-secondary">Download the Record Structure →</a>
</div>
</div>

<div class="tier primary-tier">
<div class="tier-header">
<div class="tier-eyebrow-row"><span class="tier-step">See the Completed Version · Step 02 of 03</span><span class="tier-tag recommended">Most Common</span></div>
<div class="tier-name">${s.case_file_id} · The Complete Case File</div>
<div class="tier-tagline">The completed reference DDR plus everything you need to build defensible records before your next inspection.</div>
</div>
<div class="tier-body">
<h4>Everything in the free template, plus:</h4>
<ul class="tier-includes">
<li>The complete reference DDR — fully authorized, ready as a model</li>
<li>Full alternative-causes evaluation (the field most files don't have)</li>
<li>The evidence checklist — items to gather before authorizing</li>
<li>The exact 483 observation language an investigator drafts when this gap appears</li>
<li>Cited regulatory framework: ${s.regulatory_framework}</li>
</ul>
<div class="risk-reversal"><strong>If this does not match what your investigator would expect, request a refund.</strong> No questions, no friction.</div>
</div>
<div class="tier-footer">
<div class="tier-price-block"><span class="tier-price">$149</span><span class="tier-price-note">One-time · Delivered immediately</span></div>
<a href="${s.case_file_stripe_url}" class="btn-primary large" id="cw-buy-149">Unlock the Completed Record — $149</a>
</div>
</div>

<div class="tier bundle-tier">
<div class="tier-header">
<div class="tier-eyebrow-row"><span class="tier-step">If This Isn't Isolated · Step 03 of 03</span><span class="tier-tag expansion">Save $1,193</span></div>
<div class="tier-name">The Full Inspection Set — All 10 Case Files</div>
<div class="tier-tagline">If your facility has gaps in more than one decision class, the bundle covers the full inspection surface.</div>
</div>
<div class="tier-body">
<p style="font-size:15px;color:var(--text);line-height:1.65;margin-bottom:8px;">Process Validation Conclusion · Deviation Root Cause · OOS Investigation · Deviation Risk · Change Control · CAPA Effectiveness · Data Integrity · Supplier Qualification · Stability OOT · Complaint Investigation</p>
</div>
<div class="tier-footer">
<div class="tier-price-block"><span class="tier-price">$297</span><span class="tier-price-note">All 10 · vs. $1,490 individually</span></div>
<a href="${BUNDLE_LINK}" class="btn-tertiary" id="cw-buy-bundle">Get the Full Inspection Set →</a>
</div>
</div>

</div></section>

<section class="anchor"><div class="anchor-inner">
<div class="anchor-label">Why now</div>
<p class="anchor-text">FDA inspections occur on a <strong>2-year cycle</strong>. Authorization records take longer than that to build well. Building under inspection pressure is not the same as having one in the file when the investigator arrives.</p>
</div></section>

<section class="inspector"><div class="inspector-inner">
<div class="inspector-label">The 483</div>
<div class="inspector-quote">"${s.observation_language}"</div>
<div class="inspector-followup">${s.citation_primary}. The observation that this case file is built to prevent.</div>
</div></section>

<section class="faq-section"><div class="faq-inner">
<div class="faq-label">Common Questions</div>
<h2 class="faq-title">What buyers ask before they purchase.</h2>
<div class="faq-item"><div class="faq-q">Is this a template I can use immediately?</div><div class="faq-a">Yes. Both the free template and the $149 case file include a blank DDR you can complete with your facility's data. The $149 case file adds the completed reference example, evidence checklist, and 483 reference language.</div></div>
<div class="faq-item"><div class="faq-q">What format is the file?</div><div class="faq-a">Web page formatted for print-to-PDF. Document control header, numbered sections, monospace citations — designed to look like a controlled record. Print directly from the browser, save as PDF, attach to your QMS.</div></div>
<div class="faq-item"><div class="faq-q">Does this replace my QMS workflow?</div><div class="faq-a"><strong>No.</strong> ComplianceWorxs sits above your existing QMS. Your QMS captures the event. The Decision Defense Record captures the authorization logic — the part most QMS workflows do not capture, which is the gap an investigator cites.</div></div>
<div class="faq-item"><div class="faq-q">Refund policy?</div><div class="faq-a"><strong>If the $149 case file does not match what your investigator would expect, request a refund.</strong> No questions, no friction. The bundle does not carry a refund — it is priced at 80% off individual pricing as a commitment offer for buyers who recognize the pattern across multiple decision classes.</div></div>
</div></section>

<section class="tiers-section" id="free-template-form" style="background:var(--surface); border-top:1px solid var(--border); border-bottom:1px solid var(--border); padding:64px 24px;">
<div class="tiers-inner" style="max-width:600px;">
<div class="tiers-label">Free Template · Email Delivery</div>
<h2 class="tiers-title" style="font-size:28px;">Send me the blank DDR template.</h2>
<p class="tiers-intro">Email delivery, no card required.</p>
<form id="cw-free-form" novalidate style="background:#FFFFFF; border:1px solid var(--border); padding:32px; border-radius:2px;">
<input type="email" id="cw-free-email" placeholder="your work email" required autocomplete="email" style="width:100%; padding:14px 16px; font-size:15px; border:1px solid #CDD5DB; border-radius:4px; margin-bottom:12px; outline:none;">
<button type="submit" id="cw-free-submit" class="btn-secondary" style="width:100%; padding:16px;">Send the Blank Template →</button>
<p id="cw-free-err" style="display:none; color:var(--orange); font-size:13px; margin-top:10px;"></p>
<p style="font-family:'Courier New',monospace; font-size:11px; color:var(--muted); letter-spacing:0.06em; margin-top:14px; text-align:center;">No spam · No follow-up sales sequence · Unsubscribe anytime</p>
</form>
</div>
</section>

<div class="final-cta"><div class="final-cta-inner">
<div class="final-cta-eyebrow">Decision Time</div>
<h2 class="final-cta-headline">Free template, complete case file, or full inspection set. Pick the level that matches your exposure.</h2>
<a href="#free-template-form" style="display:inline-block; margin: 4px; background:var(--green); color:#FFFFFF; padding:14px 24px; text-decoration:none; border-radius:4px; font-family:Inter,sans-serif; font-size:14px; font-weight:700;">Free Template</a>
<a href="${s.case_file_stripe_url}" style="display:inline-block; margin: 4px; background:linear-gradient(90deg,#F7C51E,#D86A2B); color:#FFFFFF; padding:14px 24px; text-decoration:none; border-radius:4px; font-family:Inter,sans-serif; font-size:14px; font-weight:700;">Case File · $149</a>
<a href="${BUNDLE_LINK}" style="display:inline-block; margin: 4px; background:transparent; color:#FFFFFF; padding:14px 24px; text-decoration:none; border:1px solid rgba(255,255,255,0.4); border-radius:4px; font-family:Inter,sans-serif; font-size:14px; font-weight:700;">Bundle · $297</a>
<p class="final-cta-trust">Used by Quality and Validation leaders preparing for FDA and EMA inspections.<br><strong>${s.regulatory_framework}</strong></p>
</div></div>

<footer class="cw-footer">ComplianceWorxs · Inspection Case File ${s.case_file_id} · ${s.citation_primary}</footer>

<script>
document.getElementById('cw-buy-149').addEventListener('click', function() { if (typeof captureEvent === 'function') captureEvent('cta_click', { position: 'page3_tier2_buy', case_file: '${s.case_file_id}', tier: 'paid_149' }); });
document.getElementById('cw-buy-bundle').addEventListener('click', function() { if (typeof captureEvent === 'function') captureEvent('cta_click', { position: 'page3_tier3_bundle', case_file: '${s.case_file_id}', tier: 'bundle_297' }); });
(function() {
  var form = document.getElementById('cw-free-form'); if (!form) return;
  var email = document.getElementById('cw-free-email'); var btn = document.getElementById('cw-free-submit'); var err = document.getElementById('cw-free-err');
  form.addEventListener('submit', function(e) {
    e.preventDefault(); var v = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { err.textContent = 'Please enter a valid email address.'; err.style.display = 'block'; email.focus(); return; }
    err.style.display = 'none'; btn.textContent = 'Sending…'; btn.disabled = true;
    if (typeof captureLeadDirect === 'function') {
      captureLeadDirect(v, 'page3_free_template_${s.public_slug}').then(function() {
        if (typeof captureEvent === 'function') captureEvent('cta_click', { position: 'page3_tier1_free', case_file: '${s.case_file_id}', tier: 'free_template' });
        var sid = localStorage.getItem('cw_session_id') || null;
        var utm = window.CW_UTM || {};
        fetch('https://balkvbmtummehgbbeqap.supabase.co/functions/v1/blank-template-send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: v, case_file_slug: '${s.public_slug}', session_id: sid, page: window.location.pathname, utm_source: utm.utm_source || '', utm_medium: utm.utm_medium || '', utm_campaign: utm.utm_campaign || '', referrer: document.referrer || '' })
        }).catch(function(){});
        form.innerHTML = '<div style="text-align:center;"><div style="font-family:Courier New,monospace; font-size:10px; letter-spacing:0.24em; text-transform:uppercase; color:var(--green); font-weight:700; margin-bottom:14px;">Sent</div><div style="font-family:Georgia,serif; font-size:20px; color:var(--navy); margin-bottom:8px;">Check your inbox.</div><p style="font-size:14px; color:var(--text-soft); line-height:1.6;">The blank DDR template is on its way.</p></div>';
      }).catch(function() { btn.textContent = 'Try again'; btn.disabled = false; err.textContent = 'Something went wrong.'; err.style.display = 'block'; });
    }
  });
})();
</script>
</body></html>`;
}

function renderTemplate(s: Scenario): string {
  const head = SHARED_HEAD(
    `Blank DDR Template — ${s.scenario_name} | ComplianceWorxs`,
    `The blank seven-section Decision Defense Record template for ${s.scenario_name}.`
  );
  return `${head}
<style>
body { padding: 0 20px 80px; }
.top-bar { background: var(--navy); padding: 12px 0; margin: 0 -20px 0; }
.top-bar-inner { max-width: 780px; margin: 0 auto; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.top-stamp { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.24em; text-transform: uppercase; color: #D1E4EA; }
.print-btn { font-family: 'Inter', sans-serif; font-size: 11px; letter-spacing: 0.10em; text-transform: uppercase; font-weight: 700; color: #FFFFFF; background: linear-gradient(90deg, var(--gold) 0%, var(--orange-bright) 100%); border: none; cursor: pointer; padding: 10px 20px; border-radius: 4px; }
.formal-header { background: #FFFFFF; border-bottom: 3px solid var(--navy); padding: 36px 0 28px; margin: 0 -20px 0; }
.formal-header-inner { max-width: 780px; margin: 0 auto; padding: 0 20px; }
.status-badge { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); margin-bottom: 14px; font-weight: 700; }
.formal-title { font-family: Georgia, serif; font-size: 36px; font-weight: 400; color: var(--navy); margin-bottom: 12px; letter-spacing: -0.018em; line-height: 1.18; }
.formal-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.12em; color: var(--muted); }
.how-block { background: var(--surface); border-bottom: 1px solid var(--border); padding: 24px 0; margin: 0 -20px 32px; }
.how-inner { max-width: 780px; margin: 0 auto; padding: 0 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 36px; }
.how-label { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--teal); font-weight: 700; margin-bottom: 10px; }
.how-question { font-family: Georgia, serif; font-size: 16px; font-style: italic; color: var(--navy); line-height: 1.55; border-left: 3px solid var(--teal); padding-left: 14px; }
.how-list { list-style: none; padding: 0; margin: 0; }
.how-list li { font-size: 13px; color: var(--text); padding: 4px 0 4px 20px; position: relative; line-height: 1.6; }
.how-list li::before { content: '✓'; position: absolute; left: 0; color: var(--teal); font-weight: 700; }
.page { max-width: 780px; margin: 0 auto; }
.notice { background: #FFFBEB; border: 1px solid var(--gold); border-left: 3px solid var(--gold); padding: 16px 20px; margin: 0 0 24px; font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: 0.06em; color: #92400E; line-height: 1.7; }
.ddr-section { background: #FFFFFF; border: 1px solid var(--border); border-left: 3px solid var(--teal); margin-bottom: 20px; overflow: hidden; }
.ddr-section.critical { border-left-color: var(--orange); }
.section-header { background: var(--surface); padding: 14px 22px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 14px; }
.section-num { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.18em; color: var(--teal); text-transform: uppercase; flex-shrink: 0; font-weight: 700; }
.section-title { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--navy); font-weight: 700; }
.section-body { padding: 22px; }
.field-row { display: grid; grid-template-columns: 220px 1fr; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border); align-items: start; }
.field-row:last-child { border-bottom: none; }
.field-label { font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.10em; text-transform: uppercase; color: var(--muted); padding-top: 4px; font-weight: 700; }
.field-value { font-size: 14px; color: var(--text); line-height: 1.65; }
.field-value.template { color: var(--muted); font-style: italic; background: #FFFBEB; padding: 8px 12px; border: 1px dashed var(--gold); display: block; border-radius: 2px; }
.upgrade-block { background: var(--navy); color: #FFFFFF; padding: 40px 32px; margin: 48px -20px 0; text-align: center; border-top: 4px solid var(--orange); }
.upgrade-inner { max-width: 600px; margin: 0 auto; }
.upgrade-eyebrow { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 16px; }
.upgrade-headline { font-family: Georgia, serif; font-size: 24px; color: #FFFFFF; line-height: 1.35; margin-bottom: 16px; }
.upgrade-sub { font-size: 15px; color: rgba(255,255,255,0.85); line-height: 1.6; margin-bottom: 28px; }
.upgrade-btn { display: inline-block; background: linear-gradient(90deg, var(--gold) 0%, var(--orange-bright) 100%); color: #FFFFFF !important; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 700; padding: 16px 32px; text-decoration: none; border-radius: 4px; }
@media print { .top-bar { display: none; } .how-block { display: none; } .upgrade-block { display: none; } body { background: #FFFFFF; padding: 20px; } .page { max-width: 100%; } }
@media (max-width: 600px) { .field-row { grid-template-columns: 1fr; gap: 4px; } .how-inner { grid-template-columns: 1fr; gap: 20px; } .formal-title { font-size: 26px; } }
</style>
</head>
<body>
<div class="top-bar"><div class="top-bar-inner"><span class="top-stamp">ComplianceWorxs · Blank DDR Template · ${s.ddr_record_id}</span><button class="print-btn" onclick="window.print()">Print / Save as PDF</button></div></div>

<div class="formal-header"><div class="formal-header-inner">
<div class="status-badge">Inspection-Ready Authorization Record · Blank Template</div>
<h1 class="formal-title">${s.scenario_name}</h1>
<div class="formal-meta"><span>${s.citation_primary}</span><span>·</span><span>${s.ddr_record_id}</span><span>·</span><span>ComplianceWorxs Decision Defense Record</span></div>
</div></div>

<div class="how-block"><div class="how-inner">
<div><div class="how-label">The investigator asks</div><div class="how-question">"${s.inspector_question}"</div></div>
<div><div class="how-label">This record provides</div><ul class="how-list">
<li>Named decision owner with authority basis</li>
<li>Every document reviewed at the moment of conclusion</li>
<li>Alternative causes considered and rejected</li>
<li>Written authorization rationale</li>
<li>Timestamped formal authorization</li>
</ul></div>
</div></div>

<div class="page">
<div class="notice">Complete every field with your facility's data. Fields marked in yellow require your input. Section 05 — Alternative Causes — is the section a 483 cites when blank. Do not skip it.</div>

<div class="ddr-section"><div class="section-header"><span class="section-num">Section 01</span><span class="section-title">Decision Identification</span></div><div class="section-body">
<div class="field-row"><div class="field-label">Record Type</div><div class="field-value">${s.scenario_name}</div></div>
<div class="field-row"><div class="field-label">Report Number</div><div class="field-value template">Enter report number</div></div>
<div class="field-row"><div class="field-label">Product / Lot</div><div class="field-value template">Enter product, lot, scope</div></div>
<div class="field-row"><div class="field-label">Decision Being Authorized</div><div class="field-value template">${s.field_1_desc.replace(/<[^>]*>/g, '').slice(0, 200)}</div></div>
<div class="field-row"><div class="field-label">Date of Decision</div><div class="field-value template">Date and time the conclusion was reached</div></div>
</div></div>

<div class="ddr-section"><div class="section-header"><span class="section-num">Section 02</span><span class="section-title">Decision Owner</span></div><div class="section-body">
<div class="field-row"><div class="field-label">Authorizing Individual</div><div class="field-value template">Full name and title</div></div>
<div class="field-row"><div class="field-label">Authority Basis</div><div class="field-value template">Reference SOP designating authority</div></div>
<div class="field-row"><div class="field-label">Independence Verification</div><div class="field-value template">Confirm independence from area where event occurred</div></div>
</div></div>

<div class="ddr-section"><div class="section-header"><span class="section-num">Section 03</span><span class="section-title">Regulatory Framework</span></div><div class="section-body">
<div class="field-row"><div class="field-label">Primary Citation</div><div class="field-value">${s.citation_primary}</div></div>
<div class="field-row"><div class="field-label">Decision Standard Applied</div><div class="field-value template">State the specific standard you applied. What criteria must be met?</div></div>
</div></div>

<div class="ddr-section"><div class="section-header"><span class="section-num">Section 04</span><span class="section-title">Evidence Reviewed at Authorization</span></div><div class="section-body">
<div class="field-row"><div class="field-label">Evidence Items</div><div class="field-value template">List every document reviewed, with reference number and date. Each item identified, each item dated.</div></div>
</div></div>

<div class="ddr-section critical"><div class="section-header"><span class="section-num">Section 05</span><span class="section-title">Alternative Causes Considered and Rejected</span></div><div class="section-body">
<div class="notice" style="margin-bottom:14px;">This section is required for inspection defense. A conclusion without documented alternative evaluation is the observation a 483 cites.</div>
<div class="field-row"><div class="field-label">Alternatives Evaluated</div><div class="field-value template">List candidate causes considered, evidence evaluated for each, basis for rejection of each. Document specifically — not "we considered alternatives."</div></div>
</div></div>

<div class="ddr-section"><div class="section-header"><span class="section-num">Section 06</span><span class="section-title">Authorization Rationale</span></div><div class="section-body">
<div class="field-value template" style="display:block;padding:18px;">Write the authorization rationale in narrative form. State (1) what direct evidence supports the conclusion, (2) why systemic causes were eliminated, (3) why the corrective action is appropriate. This is what you would say to the investigator if asked to walk them through the decision.</div>
</div></div>

<div class="ddr-section"><div class="section-header"><span class="section-num">Section 07</span><span class="section-title">Formal Authorization</span></div><div class="section-body">
<div style="border:2px solid var(--navy); padding:24px;">
<div style="font-size:14px; color:var(--navy); line-height:1.75; margin-bottom:20px;">I, the undersigned, confirm that I have personally reviewed the evidence listed in Section 04 and evaluated the alternatives in Section 05. On the basis of that review, I formally authorize the conclusion as inspection-defensible.<br><br><span style="color:var(--muted); font-style:italic;">[State the exact conclusion being authorized — specific cause, mechanism, scope]</span><br><br>This authorization was made at the time of decision. This record is not a retrospective reconstruction.</div>
<div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:16px;">
<div style="border-top:1px solid var(--navy); padding-top:8px;"><div style="font-family:Courier New,monospace; font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:var(--muted); font-weight:700;">Authorized by</div><div style="font-size:13px; color:var(--muted); margin-top:4px; font-style:italic;">Name, Title</div></div>
<div style="border-top:1px solid var(--navy); padding-top:8px;"><div style="font-family:Courier New,monospace; font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:var(--muted); font-weight:700;">Date and Time of Authorization</div><div style="font-size:13px; color:var(--muted); margin-top:4px; font-style:italic;">Date — Time (capture at moment of decision)</div></div>
<div style="border-top:1px solid var(--navy); padding-top:8px;"><div style="font-family:Courier New,monospace; font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:var(--muted); font-weight:700;">Authority Reference</div><div style="font-size:13px; color:var(--muted); margin-top:4px; font-style:italic;">SOP or procedure granting authority</div></div>
<div style="border-top:1px solid var(--navy); padding-top:8px;"><div style="font-family:Courier New,monospace; font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:var(--muted); font-weight:700;">Record Classification</div><div style="font-size:13px; color:var(--navy); margin-top:4px;">Inspection-Ready Authorization</div></div>
</div></div>
</div></div>

<div style="padding:24px 0 0; font-family:Courier New,monospace; font-size:10px; letter-spacing:0.10em; color:var(--muted); text-align:center; border-top:1px solid var(--border); margin-top:32px;">ComplianceWorxs Decision Defense Record · ${s.scenario_name} · ${s.citation_primary}</div>
</div>

<div class="upgrade-block"><div class="upgrade-inner">
<div class="upgrade-eyebrow">Need the completed reference example?</div>
<h2 class="upgrade-headline">See the full scenario authorized — every section completed.</h2>
<p class="upgrade-sub">The complete case file includes the fully-authorized reference DDR, the alternative-causes evaluation, the evidence checklist, and the 483 observation reference.</p>
<a href="https://cases.complianceworxs.com/${s.public_slug}/complete-file" class="upgrade-btn">See the Complete Case File →</a>
</div></div>

</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  const role = url.searchParams.get('role') || 'part1';

  if (!slug) {
    return new Response('Missing slug parameter', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: s, error } = await supabase
    .from('exposure_snapshots')
    .select('*')
    .eq('case_file_slug', slug)
    .eq('page_active', true)
    .maybeSingle();

  if (error || !s) {
    return new Response(`Case file not found: ${slug}`, { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }

  // Validate critical fields exist for renderable scenarios
  const required = ['scenario_name', 'case_file_id', 'citation_primary', 'inspector_question'];
  for (const f of required) {
    if (!(s as any)[f]) {
      return new Response(`Scenario incomplete: missing ${f}`, { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  }

  let html = '';
  switch (role) {
    case 'part1': html = renderPart1(s as Scenario); break;
    case 'part2': html = renderPart2(s as Scenario); break;
    case 'part3': html = renderPart3(s as Scenario); break;
    case 'template': html = renderTemplate(s as Scenario); break;
    default:
      return new Response(`Unknown role: ${role}`, { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  return new Response(html, { status: 200, headers });
});

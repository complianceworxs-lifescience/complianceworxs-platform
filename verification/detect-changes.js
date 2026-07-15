// M7-01 — map changed paths → verification gates (DR §7 gate policy).
//
// Policy (DR §7): the NARROWEST gate that covers the change must pass.
//   * contract / compiler edit          → compiler gate  (+ unit baseline)
//   * generated fixtures / tests edit    → unit gate
//   * stage engine or a stage's cert     → stage certification (that stage / all) + smoke
//   * shared-infra (runtime, harness,    → full regression
//     migrations) or a release candidate
// Steps 1–3 of §6.5 (compile, verify generated, unit tests) are the unconditional
// baseline; stage/smoke/regression are selected from the diff.
//
// Pure and DB-free: the plan is a function of the changed path list only — never a
// production-table query or time window.

// Every stage_name (DR §5.1). An edit to the stage engine touches all of them.
export const ALL_STAGES = [
  'validate_contract', 'compile_execution_spec', 'compile_prompt_spec',
  'evidence_risk_reasoning', 'authorization_reasoning', 'gap_analysis', 'claim_status',
  'evidence_traceability', 'unsupported_claims', 'inspector_challenge', 'remediation_scaffold',
  'deterministic_assembly', 'executive_brief', 'schema_validation', 'final_assembly',
];

function matchStageDir(p) {
  const m = p.match(/^tests\/stage-certification\/([^/]+)\//);
  return m && ALL_STAGES.includes(m[1]) ? m[1] : null;
}

export function detectChanges(paths, opts = {}) {
  const changed = [...new Set(paths.filter(Boolean))].sort();
  const reasons = [];
  const stages = new Set();
  let compiler = false, unit = false, regression = false, resilience = false;
  const releaseCandidate = !!opts.releaseCandidate;

  // M7A resilience surface: the canonical taxonomy/evaluator/breaker, their certification, and
  // the two functions that embed the resilience decision logic (irr-stage-engine, irr-job-worker).
  const RESILIENCE_RE = /^(resilience\/|tests\/resilience-classification\/|edge-functions\/irr-stage-engine\/|edge-functions\/irr-job-worker\/)/;

  for (const p of changed) {
    // --- primary gate (first match wins) ---
    if (/^edge-functions\/runtime\//.test(p)) { regression = true; reasons.push(`regression: runtime changed (${p})`); }
    else if (/^verification\//.test(p)) { regression = true; reasons.push(`regression: verification harness changed (${p})`); }
    else if (/^supabase\/migrations\//.test(p)) { regression = true; reasons.push(`regression: schema/migration changed (${p})`); }
    // stage engine → all stages + smoke
    else if (/^edge-functions\/irr-stage-engine\//.test(p)) { for (const s of ALL_STAGES) stages.add(s); reasons.push(`stage: irr-stage-engine changed → all stages + smoke (${p})`); }
    // a single stage's certification
    else if (matchStageDir(p)) { const s = matchStageDir(p); stages.add(s); reasons.push(`stage: ${s} certification changed → ${s} + smoke (${p})`); }
    // contract / compiler
    else if (/^compiler\//.test(p)) { compiler = true; unit = true; reasons.push(`compiler: contract/compiler changed (${p})`); }
    // generated fixtures / tests
    else if (/^tests\/(generated|fixtures)\//.test(p)) { unit = true; reasons.push(`unit: generated fixtures/tests changed (${p})`); }
    // dormant worker → resilience gate only (added below); no full regression
    else if (/^edge-functions\/irr-job-worker\//.test(p)) { /* resilience gate handles it below */ }
    // other stage/pipeline edge functions → conservative full regression
    else if (/^edge-functions\//.test(p)) { regression = true; reasons.push(`regression: edge function changed (${p})`); }
    // anything else (docs, README, scripts) → no primary gate

    // --- resilience gate (M7A-01/02/03/10; independent — a stage-engine/worker edit fires BOTH
    //     its primary gate AND resilience, since those functions embed the resilience decision logic).
    if (RESILIENCE_RE.test(p)) { resilience = true; reasons.push(`resilience: taxonomy+classification+decide+breaker (${p})`); }
  }

  if (releaseCandidate) { regression = true; resilience = true; reasons.push('regression + resilience: release candidate (CW_RELEASE_CANDIDATE / --rc)'); }

  const stageList = [...stages].sort((a, b) => ALL_STAGES.indexOf(a) - ALL_STAGES.indexOf(b));
  const smoke = stageList.length > 0 || regression; // a stage edit (or RC/regression) requires one complete execution

  return {
    changed,
    releaseCandidate,
    gates: {
      // baseline (§6.5 steps 1–3) is always applicable
      compiler: true,
      unit: true,
      stages: stageList,
      smoke,
      regression,
      resilience,
    },
    reasons: reasons.length ? reasons : ['no change-specific gate matched; running baseline (compiler + unit) only'],
  };
}

// CLI: node verification/detect-changes.js --diff "a,b,c" [--rc]  → prints the plan as JSON
if (import.meta.url === `file://${process.argv[1]}`) {
  const di = process.argv.indexOf('--diff');
  const raw = di !== -1 ? (process.argv[di + 1] || '') : (process.env.CW_VERIFY_DIFF || '');
  const paths = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const plan = detectChanges(paths, { releaseCandidate: process.argv.includes('--rc') || process.env.CW_RELEASE_CANDIDATE === '1' });
  console.log(JSON.stringify(plan, null, 2));
}

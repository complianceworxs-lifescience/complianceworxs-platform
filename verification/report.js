// M7-13 — concise verification report (human + machine-readable JSON).
//
// One unambiguous aggregate pass/fail plus a per-gate breakdown. The JSON form is
// suitable for PR attachment (DR §16 Reporting).

export function buildReport({ runId, plan, gates, startedAt, totalMs }) {
  const overall = gates.every((g) => g.ok) ? 'pass' : 'fail';
  return {
    gate: 'CP-6 / npm run verify',
    run_id: runId,
    overall,
    total_ms: totalMs,
    started_at: startedAt,
    selected_gates: plan.gates,
    reasons: plan.reasons,
    changed: plan.changed,
    gates: gates.map((g) => ({ name: g.name, ok: g.ok, ms: g.ms, summary: g.summary })),
  };
}

export function renderHuman(report) {
  const lines = [];
  lines.push(`verify — run_id=${report.run_id}  (${report.total_ms} ms total)`);
  lines.push(`  changed: ${report.changed.length ? report.changed.join(', ') : '(none)'}`);
  lines.push('  gate selection:');
  for (const r of report.reasons) lines.push(`    · ${r}`);
  lines.push('  results:');
  for (const g of report.gates) lines.push(`    ${g.ok ? 'PASS' : 'FAIL'}  ${g.name.padEnd(22)} ${String(g.ms).padStart(6)} ms   ${g.summary}`);
  lines.push(`  OVERALL: ${report.overall.toUpperCase()}`);
  return lines.join('\n');
}

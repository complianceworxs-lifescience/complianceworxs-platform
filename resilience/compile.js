#!/usr/bin/env node
// Resilience taxonomy compiler for the ComplianceWorxs IRR pipeline (Milestone 7A, M7A-01/02).
// Reads the two single-source-of-truth files and generates:
//   - generated/resilience-schema.json   (the taxonomy + policy as data)
//   - generated/resilience-generated.ts  (typed maps imported by the IRR execution path)
//   - generated/RESILIENCE.md            (human-readable doc)
//
// Nobody hand-edits generated/. Edit taxonomy.yaml / policy.yaml and rerun:
//   node compile.js
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const HERE = __dirname;
const OUT_DIR = path.join(HERE, 'generated');

const taxonomy = yaml.load(fs.readFileSync(path.join(HERE, 'taxonomy.yaml'), 'utf8'));
const policy = yaml.load(fs.readFileSync(path.join(HERE, 'policy.yaml'), 'utf8'));

// --- validation (a malformed taxonomy fails the compile, hence the gate) ---------------
const BASE_POLICIES = new Set(['retryable', 'conditional', 'terminal']);
function die(msg) { console.error('resilience compile FAIL — ' + msg); process.exit(1); }

const categories = taxonomy.categories;
if (!Array.isArray(categories) || categories.length === 0) die('taxonomy.categories is empty.');
const catSet = new Set(categories);

for (const [reason, entry] of Object.entries(taxonomy.reasons)) {
  if (!entry || !catSet.has(entry.category)) die(`reason "${reason}" has unknown category "${entry && entry.category}".`);
  if (!BASE_POLICIES.has(entry.base_policy)) die(`reason "${reason}" has invalid base_policy "${entry && entry.base_policy}".`);
}
if (!taxonomy.default || !catSet.has(taxonomy.default.category) || !BASE_POLICIES.has(taxonomy.default.base_policy)) {
  die('taxonomy.default is missing or invalid.');
}
for (const cat of categories) {
  const p = policy.policies[cat];
  if (!p) die(`policy.yaml has no policy for category "${cat}".`);
  for (const k of ['retry', 'max_attempts', 'backoff_base_ms', 'backoff_cap_ms', 'jitter_ratio', 'honor_retry_after']) {
    if (!(k in p)) die(`policy for category "${cat}" is missing "${k}".`);
  }
}
if (!policy.breaker || typeof policy.breaker.enabled !== 'boolean') die('policy.breaker is missing or has no boolean "enabled".');

fs.mkdirSync(OUT_DIR, { recursive: true });

// --- 1. schema (data as JSON) ----------------------------------------------------------
const schema = {
  taxonomy_version: taxonomy.version,
  policy_version: policy.version,
  categories,
  reasons: taxonomy.reasons,
  default: taxonomy.default,
  policies: policy.policies,
  breaker: policy.breaker,
};
fs.writeFileSync(path.join(OUT_DIR, 'resilience-schema.json'), JSON.stringify(schema, null, 2) + '\n');

// --- 2. resilience-generated.ts --------------------------------------------------------
const categoryUnion = categories.map((c) => `'${c}'`).join(' | ');
const L = [];
L.push(`// GENERATED FILE -- do not edit by hand.`);
L.push(`// Source of truth: resilience/taxonomy.yaml + resilience/policy.yaml. Regenerate: node compile.js`);
L.push(`// Milestone 7A (CW-MDR-007A) M7A-01/02: the ONE place reason -> category -> policy is defined.`);
L.push('');
L.push(`export type ErrorCategory = ${categoryUnion};`);
L.push(`export type BasePolicy = 'retryable' | 'conditional' | 'terminal';`);
L.push('');
L.push(`export const TAXONOMY_VERSION = '${taxonomy.version}';`);
L.push(`export const POLICY_VERSION = '${policy.version}';`);
L.push(`export const CATEGORIES: ErrorCategory[] = ${JSON.stringify(categories)};`);
L.push('');
L.push(`export interface ReasonEntry { category: ErrorCategory; base_policy: BasePolicy; honor_retry_after?: boolean; }`);
L.push(`// reason -> classification. The ONLY place this mapping exists (CW-ARCH-001 §9.3).`);
L.push(`export const TAXONOMY: Record<string, ReasonEntry> = ${JSON.stringify(taxonomy.reasons, null, 2)};`);
L.push('');
L.push(`// Fail-safe classification for an unmapped reason (bounded operational retry).`);
L.push(`export const DEFAULT_REASON_ENTRY: ReasonEntry = ${JSON.stringify(taxonomy.default, null, 2)};`);
L.push('');
L.push(`export interface RetryPolicy {`);
L.push(`  retry: boolean;`);
L.push(`  max_attempts: number;`);
L.push(`  backoff_base_ms: number;`);
L.push(`  backoff_cap_ms: number;`);
L.push(`  jitter_ratio: number;`);
L.push(`  honor_retry_after: boolean;`);
L.push(`}`);
L.push(`// category -> retry policy. Values are provisional bootstraps (see policy.yaml provenance).`);
L.push(`export const POLICY: Record<ErrorCategory, RetryPolicy> = ${JSON.stringify(policy.policies, null, 2)};`);
L.push('');
L.push(`export interface BreakerConfig {`);
L.push(`  enabled: boolean;`);
L.push(`  window_seconds: number;`);
L.push(`  consecutive_failures_threshold: number;`);
L.push(`  cooldown_seconds: number;`);
L.push(`  keyed_by: string;`);
L.push(`}`);
L.push(`// Circuit breaker config (M7A-10). enabled=false until operational evidence justifies it.`);
L.push(`export const BREAKER: BreakerConfig = ${JSON.stringify(policy.breaker, null, 2)};`);
L.push('');
fs.writeFileSync(path.join(OUT_DIR, 'resilience-generated.ts'), L.join('\n'));

// --- 3. human-readable doc -------------------------------------------------------------
const md = [`# IRR Resilience Taxonomy (generated from taxonomy.yaml + policy.yaml)`, ``];
md.push(`Taxonomy v${taxonomy.version} · Policy v${policy.version}`, ``);
md.push(`## Reason → Category → Base policy`, ``, `| Reason | Category | Base policy | honor_retry_after |`, `|---|---|---|---|`);
for (const [reason, e] of Object.entries(taxonomy.reasons)) {
  md.push(`| \`${reason}\` | ${e.category} | ${e.base_policy} | ${e.honor_retry_after ? 'yes' : ''} |`);
}
md.push(`| _(default / unmapped)_ | ${taxonomy.default.category} | ${taxonomy.default.base_policy} | |`, ``);
md.push(`## Category → Retry policy (provisional bootstraps)`, ``, `| Category | retry | max_attempts | backoff_base_ms | backoff_cap_ms | jitter_ratio | honor_retry_after |`, `|---|---|---|---|---|---|---|`);
for (const cat of categories) {
  const p = policy.policies[cat];
  md.push(`| ${cat} | ${p.retry} | ${p.max_attempts} | ${p.backoff_base_ms} | ${p.backoff_cap_ms} | ${p.jitter_ratio} | ${p.honor_retry_after} |`);
}
md.push(``, `## Circuit breaker (M7A-10)`, ``, `\`enabled: ${policy.breaker.enabled}\` — ships off until operational evidence justifies it (CW-GOV-001 §7.3 "where justified").`, ``);
fs.writeFileSync(path.join(OUT_DIR, 'RESILIENCE.md'), md.join('\n') + '\n');

console.log(`Compiled taxonomy (${Object.keys(taxonomy.reasons).length} reasons, ${categories.length} categories) -> ${OUT_DIR}`);

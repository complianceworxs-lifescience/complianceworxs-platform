#!/usr/bin/env node
// Contract Compiler for the ComplianceWorxs IRR pipeline.
// Reads contract.yaml (the single source of truth) and generates:
//   - generated/contract-schema.json   (JSON Schema, one entry per field)
//   - generated/contract-generated.ts  (validators + prompt fragments + TS types, imported by irr-stage-engine)
//   - generated/CONTRACT.md            (human-readable doc)
//
// Nobody hand-edits the generated/ directory. Edit contract.yaml and rerun:
//   node compile.js

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SPEC_PATH = path.join(__dirname, 'contract.yaml');
const OUT_DIR = path.join(__dirname, 'generated');

const doc = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
const fields = doc.fields;
const fieldNames = Object.keys(fields);

fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// 1. JSON Schema
// ---------------------------------------------------------------------------
function toJsonSchemaField(spec) {
  if (spec.type === 'array') {
    const itemSchema = { type: spec.items.type };
    if (spec.items.properties) {
      itemSchema.properties = {};
      for (const [k, v] of Object.entries(spec.items.properties)) {
        itemSchema.properties[k] = v.type ? { type: v.type, ...(v.enum ? { enum: v.enum } : {}) } : {};
      }
    }
    return { type: 'array', items: itemSchema };
  }
  const out = { type: spec.type };
  if (spec.enum) out.enum = spec.enum;
  return out;
}
const jsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: Object.fromEntries(fieldNames.map((f) => [f, toJsonSchemaField(fields[f])])),
};
fs.writeFileSync(path.join(OUT_DIR, 'contract-schema.json'), JSON.stringify(jsonSchema, null, 2) + '\n');

// ---------------------------------------------------------------------------
// 2. contract-generated.ts
// ---------------------------------------------------------------------------
function tsTypeFor(spec) {
  if (spec.type === 'string') {
    if (spec.enum) return spec.enum.map((v) => `'${v}'`).join(' | ');
    return 'string';
  }
  if (spec.type === 'array') {
    const it = spec.items;
    if (it.type === 'string') return 'Array<string>';
    if (it.type === 'object') {
      if (it.properties) {
        const propStrs = Object.entries(it.properties).map(([k, v]) => {
          if (!v || Object.keys(v).length === 0) return `${k}: any`;
          if (v.enum) return `${k}: ${v.enum.map((e) => `'${e}'`).join(' | ')}`;
          if (v.type === 'string') return `${k}: string`;
          return `${k}: any`;
        });
        return `Array<{ ${propStrs.join('; ')} }>`;
      }
      return 'Array<Record<string, any>>';
    }
    return 'Array<any>';
  }
  return 'any';
}

const tsLines = [];
tsLines.push(`// GENERATED FILE -- do not edit by hand.`);
tsLines.push(`// Source of truth: contract.yaml. Regenerate with: node compile.js`);
tsLines.push('');
tsLines.push(`// ---------- TypeScript interface ----------`);
tsLines.push(`export interface IrrContractFields {`);
for (const name of fieldNames) {
  tsLines.push(`  ${name}: ${tsTypeFor(fields[name])};`);
}
tsLines.push(`}`);
tsLines.push('');

// ---- Prompt constraint fragments ----
function promptConstraintFor(name, spec) {
  if (spec.source === 'derived') return null; // no prompt fragment for non-model fields
  if (spec.type === 'string' && spec.enum) {
    return `${name} must be exactly one of: ${spec.enum.map((v) => `\\"${v}\\"`).join(', ')}.`;
  }
  if (spec.type === 'string') {
    return `${name} is a single prose string. Do not output an array, list, bullets, or numbered items.`;
  }
  if (spec.type === 'array') {
    const it = spec.items;
    if (it.type === 'string') {
      return `${name} is a JSON array whose items are plain strings.`;
    }
    if (it.type === 'object' && it.properties) {
      const shape = Object.entries(it.properties)
        .map(([k, v]) => {
          if (v.enum) return `\\"${k}\\": <${v.enum.map((e) => `\\"${e}\\"`).join(' | ')}>`;
          return `\\"${k}\\": <${v.type ?? 'string'}>`;
        })
        .join(', ');
      return `Each ${name} entry MUST be a JSON object of the exact shape {${shape}} -- never a bare string, never a nested array, never additional keys.`;
    }
    return `${name} is a JSON array whose items are JSON objects -- never bare strings.`;
  }
  return null;
}

tsLines.push(`// ---------- Prompt constraint fragments (one per model-generated field) ----------`);
tsLines.push(`export const PROMPT_CONSTRAINTS: Record<string, string> = {`);
for (const name of fieldNames) {
  const c = promptConstraintFor(name, fields[name]);
  if (c === null) continue;
  tsLines.push(`  ${name}: "${c}",`);
}
tsLines.push(`};`);
tsLines.push('');

tsLines.push(`// Returns the constraint lines for a given list of fields, in order, skipping`);
tsLines.push(`// any field with no generated fragment (e.g. derived/non-model fields).`);
tsLines.push(`export function constraintsFor(fieldNames: string[]): string[] {`);
tsLines.push(`  return fieldNames.map((f) => PROMPT_CONSTRAINTS[f]).filter((c): c is string => !!c);`);
tsLines.push(`}`);
tsLines.push('');

tsLines.push(`// ---------- Runtime validators ----------`);
tsLines.push(`// Thrown errors match the { retryable, reason, message } shape the stage engine`);
tsLines.push(`// already expects, so a contract violation enters the existing retry path.`);
tsLines.push(`function fail(context: string, message: string): never {`);
tsLines.push(`  throw { retryable: true, reason: 'malformed_array_item', message: \`\${context}: \${message}\` };`);
tsLines.push(`}`);
tsLines.push('');
tsLines.push(`export const FIELD_SPECS: Record<string, any> = ${JSON.stringify(fields, null, 2)};`);
tsLines.push('');

tsLines.push(`// Generic validator: checks a field's array items against its contract.yaml`);
tsLines.push(`// spec (object vs string items, required properties, enum values). This is`);
tsLines.push(`// what replaces the old hand-written assertArrayOfObjects/assertClaimStatusShape --`);
tsLines.push(`// there is exactly one place that knows a field's shape, and it is generated.`);
tsLines.push(`export function validateFieldItems(fieldName: string, items: any[], context: string): void {`);
tsLines.push(`  const spec = FIELD_SPECS[fieldName];`);
tsLines.push(`  if (!spec || spec.type !== 'array') return;`);
tsLines.push(`  const itemSpec = spec.items;`);
tsLines.push(`  items.forEach((item: any, i: number) => {`);
tsLines.push(`    if (itemSpec.type === 'object') {`);
tsLines.push(`      if (typeof item !== 'object' || item === null || Array.isArray(item)) {`);
tsLines.push(`        fail(context, \`\${fieldName}[\${i}] must be a JSON object but got \${Array.isArray(item) ? 'an array' : typeof item} (\${JSON.stringify(item).slice(0, 120)}).\`);`);
tsLines.push(`      }`);
tsLines.push(`      if (itemSpec.properties) {`);
tsLines.push(`        for (const [prop, propSpec] of Object.entries<any>(itemSpec.properties)) {`);
tsLines.push(`          const val = (item as any)[prop];`);
tsLines.push(`          if (propSpec.type === 'string' && typeof val !== 'string') {`);
tsLines.push(`            fail(context, \`\${fieldName}[\${i}].\${prop} must be a string (got \${JSON.stringify(val)}).\`);`);
tsLines.push(`          }`);
tsLines.push(`          if (propSpec.enum && !propSpec.enum.includes(val)) {`);
tsLines.push(`            fail(context, \`\${fieldName}[\${i}].\${prop} "\${val}" is not one of the allowed values: \${propSpec.enum.join(' | ')}.\`);`);
tsLines.push(`          }`);
tsLines.push(`        }`);
tsLines.push(`      }`);
tsLines.push(`    } else if (itemSpec.type === 'string') {`);
tsLines.push(`      if (typeof item !== 'string') {`);
tsLines.push(`        fail(context, \`\${fieldName}[\${i}] must be a string but got \${typeof item} (\${JSON.stringify(item).slice(0, 120)}).\`);`);
tsLines.push(`      }`);
tsLines.push(`    }`);
tsLines.push(`  });`);
tsLines.push(`}`);
tsLines.push('');

tsLines.push(`// Top-level type contract line, generated from the spec rather than hand-typed --`);
tsLines.push(`// this is the sentence that drifted from the schema and caused the Stage 7 bug.`);
tsLines.push(`export const TYPE_CONTRACT_LINE = 'Type contract: any field name ending in "_list" must be a JSON array. Every other field must be a single string (never an array, object, or list) unless a constraint below states otherwise. When a field\\'s array items are objects, the exact per-item shape is specified in the constraints below -- follow it precisely; never substitute a bare string for a required object item.';`);
tsLines.push('');

fs.writeFileSync(path.join(OUT_DIR, 'contract-generated.ts'), tsLines.join('\n'));

// ---------------------------------------------------------------------------
// 3. Human-readable doc
// ---------------------------------------------------------------------------
const mdLines = [`# IRR Contract (generated from contract.yaml)`, ``, `| Field | Stage | Source | Type | Notes |`, `|---|---|---|---|---|`];
for (const name of fieldNames) {
  const s = fields[name];
  const typeStr = s.type === 'array' ? `array<${s.items.type}>` : (s.enum ? 'enum' : s.type);
  mdLines.push(`| \`${name}\` | ${s.stage} | ${s.source} | ${typeStr} | ${s.description.replace(/\n/g, ' ').trim()} |`);
}
fs.writeFileSync(path.join(OUT_DIR, 'CONTRACT.md'), mdLines.join('\n') + '\n');

console.log(`Compiled ${fieldNames.length} fields -> ${OUT_DIR}`);

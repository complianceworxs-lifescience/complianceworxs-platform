#!/usr/bin/env node
// M7-07 / M7-08: generate validator tests + prompt-fragment tests FROM contract.yaml.
// Output (deterministic; fields in contract order; no timestamps/random):
//   tests/generated/validator.test.mjs        -- exercises the generated validateFieldItems
//                                                against the generated fixtures (array fields).
//   tests/generated/prompt-fragment.test.mjs  -- pins each model field's PROMPT_CONSTRAINTS
//                                                entry to the contract-derived expectation;
//                                                asserts derived fields have no fragment.
// The prompt-fragment "expected" strings are DERIVED from contract.yaml here (mirroring the
// compiler's promptConstraintFor rule, in runtime/decoded form). Running the emitted tests
// cross-checks compiler/generated/contract-generated.ts against that derivation.
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const HERE = __dirname;
const CONTRACT = path.join(HERE, 'contract.yaml');
const OUT = path.resolve(HERE, '..', 'tests', 'generated');

const doc = yaml.load(fs.readFileSync(CONTRACT, 'utf8'));
const fields = doc.fields;
const names = Object.keys(fields);

// Runtime (decoded) form of the compiler's promptConstraintFor. Must match the values in
// compiler/generated/contract-generated.ts PROMPT_CONSTRAINTS exactly.
function runtimeConstraint(name, spec) {
  if (spec.source === 'derived') return null; // no fragment for non-model fields
  if (spec.type === 'string' && spec.enum) {
    return `${name} must be exactly one of: ${spec.enum.map((v) => `"${v}"`).join(', ')}.`;
  }
  if (spec.type === 'string') {
    return `${name} is a single prose string. Do not output an array, list, bullets, or numbered items.`;
  }
  if (spec.type === 'array') {
    const it = spec.items || {};
    if (it.type === 'string') return `${name} is a JSON array whose items are plain strings.`;
    if (it.type === 'object' && it.properties) {
      const shape = Object.entries(it.properties)
        .map(([k, v]) => (v.enum ? `"${k}": <${v.enum.map((e) => `"${e}"`).join(' | ')}>` : `"${k}": <${v.type ?? 'string'}>`))
        .join(', ');
      return `Each ${name} entry MUST be a JSON object of the exact shape {${shape}} -- never a bare string, never a nested array, never additional keys.`;
    }
    return `${name} is a JSON array whose items are JSON objects -- never bare strings.`;
  }
  return null;
}

const arrayFields = names.filter((n) => fields[n].type === 'array');
const expected = {};        // model field -> expected constraint (contract order)
const noFragment = [];      // fields that must have NO prompt fragment
for (const n of names) {
  const c = runtimeConstraint(n, fields[n]);
  if (c === null) noFragment.push(n);
  else expected[n] = c;
}

const HEADER = (what) =>
  `// GENERATED FILE -- do not edit by hand.\n` +
  `// Source of truth: contract.yaml. Regenerate with: node compiler/generate-tests.js\n` +
  `// ${what}\n` +
  `// Run: node --experimental-strip-types --test tests/generated/*.mjs\n\n`;

const validatorTest =
  HEADER('M7-07: exercises the generated validateFieldItems against the generated fixtures.') +
  `import { test } from 'node:test';\n` +
  `import assert from 'node:assert/strict';\n` +
  `import { readFileSync } from 'node:fs';\n` +
  `import { fileURLToPath } from 'node:url';\n` +
  `import { dirname, join } from 'node:path';\n` +
  `import { validateFieldItems } from '../../compiler/generated/contract-generated.ts';\n\n` +
  `const HERE = dirname(fileURLToPath(import.meta.url));\n` +
  `const FIX = join(HERE, '..', 'fixtures', 'generated');\n` +
  `const load = (f) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));\n\n` +
  `const ARRAY_FIELDS = ${JSON.stringify(arrayFields, null, 2)};\n\n` +
  `for (const field of ARRAY_FIELDS) {\n` +
  `  test(\`validator: \${field} accepts its valid fixture\`, () => {\n` +
  `    assert.doesNotThrow(() => validateFieldItems(field, load(\`\${field}.valid.json\`), \`test:\${field}\`));\n` +
  `  });\n` +
  `  test(\`validator: \${field} rejects its invalid fixture\`, () => {\n` +
  `    assert.throws(() => validateFieldItems(field, load(\`\${field}.invalid.json\`), \`test:\${field}\`));\n` +
  `  });\n` +
  `}\n`;

const promptTest =
  HEADER('M7-08: pins each model field\'s PROMPT_CONSTRAINTS entry to the contract-derived expectation.') +
  `import { test } from 'node:test';\n` +
  `import assert from 'node:assert/strict';\n` +
  `import { PROMPT_CONSTRAINTS } from '../../compiler/generated/contract-generated.ts';\n\n` +
  `const EXPECTED = ${JSON.stringify(expected, null, 2)};\n\n` +
  `const NO_FRAGMENT = ${JSON.stringify(noFragment, null, 2)};\n\n` +
  `for (const [field, want] of Object.entries(EXPECTED)) {\n` +
  `  test(\`prompt-fragment: \${field} matches contract\`, () => {\n` +
  `    assert.equal(PROMPT_CONSTRAINTS[field], want);\n` +
  `  });\n` +
  `}\n` +
  `for (const field of NO_FRAGMENT) {\n` +
  `  test(\`prompt-fragment: \${field} (derived) has no fragment\`, () => {\n` +
  `    assert.ok(!(field in PROMPT_CONSTRAINTS), \`\${field} should have no prompt fragment\`);\n` +
  `  });\n` +
  `}\n`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'validator.test.mjs'), validatorTest);
fs.writeFileSync(path.join(OUT, 'prompt-fragment.test.mjs'), promptTest);
console.log(`generated validator.test.mjs (${arrayFields.length} array fields) + prompt-fragment.test.mjs (${Object.keys(expected).length} model fields, ${noFragment.length} derived) -> tests/generated/`);

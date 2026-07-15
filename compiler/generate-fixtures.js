#!/usr/bin/env node
// M7-05 / M7-06: generate valid + invalid fixtures per contract field FROM contract.yaml.
// Output: tests/fixtures/generated/<field>.valid.json and <field>.invalid.json (+ _index.json).
// Deterministic: fields iterated in contract order; fixed JSON formatting; no timestamps/random.
// Invalid fixtures for ARRAY fields are engineered to trip the generated validateFieldItems
// (bad item type / bad enum / non-string prop). Scalar-field invalids represent contract
// violations enforced at the prompt-constraint layer (validateFieldItems is array-only).
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const HERE = __dirname;
const CONTRACT = path.join(HERE, 'contract.yaml');
const OUT = path.resolve(HERE, '..', 'tests', 'fixtures', 'generated');

const doc = yaml.load(fs.readFileSync(CONTRACT, 'utf8'));
const fields = doc.fields;
const names = Object.keys(fields); // contract order (js-yaml preserves it)

function validObject(props) {
  const o = {};
  for (const [k, pv] of Object.entries(props)) {
    o[k] = pv.enum ? pv.enum[0] : (pv.type === 'string' ? `example ${k}` : 'example');
  }
  return o;
}

function validFor(name, spec) {
  if (spec.type === 'string') return spec.enum ? spec.enum[0] : `Example ${name}: a single prose string.`;
  if (spec.type === 'array') {
    const it = spec.items || {};
    if (it.type === 'string') return ['example one', 'example two'];
    if (it.type === 'object') return [it.properties ? validObject(it.properties) : { example: 'value' }];
  }
  return null;
}

function invalidFor(name, spec) {
  if (spec.type === 'string') {
    // scalar violation (not policed by validateFieldItems; enforced at prompt/schema layer)
    return spec.enum ? '__invalid_enum_value__' : ['not', 'a', 'single', 'string'];
  }
  if (spec.type === 'array') {
    const it = spec.items || {};
    if (it.type === 'string') return [123]; // non-string item -> validateFieldItems throws
    if (it.type === 'object') {
      if (it.properties) {
        const entries = Object.entries(it.properties);
        const enumProp = entries.find(([, pv]) => pv.enum);
        if (enumProp) {
          const o = validObject(it.properties);
          o[enumProp[0]] = '__invalid_enum__'; // bad enum -> throws
          return [o];
        }
        const strProp = entries.find(([, pv]) => pv.type === 'string');
        if (strProp) {
          const o = validObject(it.properties);
          o[strProp[0]] = 12345; // non-string where string required -> throws
          return [o];
        }
      }
      return ['bare string, not a JSON object']; // item not object -> throws
    }
  }
  return null;
}

function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const index = [];
for (const name of names) {
  const spec = fields[name];
  writeJson(path.join(OUT, `${name}.valid.json`), validFor(name, spec));
  writeJson(path.join(OUT, `${name}.invalid.json`), invalidFor(name, spec));
  index.push({
    field: name,
    type: spec.type,
    item: spec.type === 'array' ? (spec.items && spec.items.type) : null,
    array_validated: spec.type === 'array', // validateFieldItems only validates arrays
    source: spec.source,
    valid: `${name}.valid.json`,
    invalid: `${name}.invalid.json`,
  });
}
writeJson(path.join(OUT, '_index.json'), index);
console.log(`generated ${names.length * 2} fixtures (+ _index.json) for ${names.length} fields -> tests/fixtures/generated/`);

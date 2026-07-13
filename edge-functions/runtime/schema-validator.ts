import { OutputSchema } from './prompt-schema.ts';

export interface SchemaValidationResult { valid: boolean; missingFields: string[]; typeMismatches: string[]; unexpectedFields: string[]; }

// Strict-shape enforcement: previously this only checked that required fields
// were present and correctly typed -- it never checked whether the model
// emitted fields OUTSIDE the contract's schema. EC-05 (Milestone 6 edge case)
// exposed this: the model added `executiveRiskStatement`, a field the Prompt/
// Recipe Specification never defined, and the old validator let it through
// as a D3 pass since all the REQUIRED fields were still present and correctly
// typed. The contract is the full allowed shape, not just a floor -- any key
// not in schema.properties is now a hard rejection.
export function validateAgainstOutputSchema(parsed: Record<string, unknown> | null, schema: OutputSchema): SchemaValidationResult {
  if (!parsed) return { valid: false, missingFields: [...schema.required], typeMismatches: [], unexpectedFields: [] };

  const missingFields: string[] = [];
  const typeMismatches: string[] = [];

  const allowedFields = new Set(Object.keys(schema.properties));
  const unexpectedFields = Object.keys(parsed).filter((k) => !allowedFields.has(k));

  for (const field of schema.required) {
    if (!(field in parsed)) { missingFields.push(field); continue; }
    const expectedType = schema.properties[field]?.type;
    const value = parsed[field];
    const actualIsArray = Array.isArray(value);
    if (expectedType === 'array' && !actualIsArray) typeMismatches.push(field);
    if (expectedType === 'string' && (actualIsArray || typeof value !== 'string')) typeMismatches.push(field);
  }

  return {
    valid: missingFields.length === 0 && typeMismatches.length === 0 && unexpectedFields.length === 0,
    missingFields,
    typeMismatches,
    unexpectedFields,
  };
}

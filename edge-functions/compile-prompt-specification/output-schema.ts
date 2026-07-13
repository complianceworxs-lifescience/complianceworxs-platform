import { ExecutionSpecification } from './execution-schema.ts';
import { OutputSchema } from './prompt-schema.ts';

const LIST_SUFFIXES = ['_list', '_items'];

function inferType(fieldName: string): 'string' | 'array' {
  return LIST_SUFFIXES.some((suffix) => fieldName.endsWith(suffix)) ? 'array' : 'string';
}

export function buildOutputSchema(es: ExecutionSpecification): OutputSchema {
  const properties: OutputSchema['properties'] = {};
  for (const field of es.requiredOutputs) {
    properties[field] = { type: inferType(field) };
  }
  return { type: 'object', required: [...es.requiredOutputs], properties };
}
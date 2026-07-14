import { ExecutionSpecification } from './execution-schema.ts';

export function buildContextRequirements(es: ExecutionSpecification): string[] {
  return [...es.requiredInputs];
}

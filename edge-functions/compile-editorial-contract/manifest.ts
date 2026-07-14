import { createHash } from 'node:crypto';
import { ExecutionSpecification, CompilerProvenance } from './execution-schema.ts';
import { RULE_REGISTRY_VERSION } from './rules.ts';

export const ARCHITECTURE_VERSION = '2.0.0';
export const COMPILER_VERSION = '1.0.0';

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function computeChecksum(spec: Omit<ExecutionSpecification, 'compiler'> & { compiler: Omit<CompilerProvenance, 'checksum' | 'timestamp'> }): string {
  return createHash('sha256').update(stableStringify(spec)).digest('hex');
}

export function buildProvenance(sourceContractId: string, specWithoutProvenance: Omit<ExecutionSpecification, 'compiler'>): CompilerProvenance {
  const timestamp = new Date().toISOString();
  const provenanceWithoutTimestampOrChecksum = { architectureVersion: ARCHITECTURE_VERSION, compilerVersion: COMPILER_VERSION, ruleRegistryVersion: RULE_REGISTRY_VERSION, sourceContractId };
  const checksum = computeChecksum({ ...specWithoutProvenance, compiler: provenanceWithoutTimestampOrChecksum });
  return { ...provenanceWithoutTimestampOrChecksum, timestamp, checksum };
}

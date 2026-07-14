import { createHash } from 'node:crypto';
import { PromptManifest, PromptPackage, TargetRuntime } from './prompt-schema.ts';
import { ExecutionSpecification } from './execution-schema.ts';
import { stableStringify } from './m2-manifest.ts';
import { PROMPT_COMPILER_VERSION } from './manifest.ts';

export function buildPromptManifest(es: ExecutionSpecification, targetRuntime: TargetRuntime, packageWithoutManifest: Omit<PromptPackage, 'manifest'>): PromptManifest {
  const timestamp = new Date().toISOString();
  const base = { promptCompilerVersion: PROMPT_COMPILER_VERSION, targetRuntime, executionSpecificationId: es.id, executionSpecificationChecksum: es.compiler.checksum };
  const checksum = createHash('sha256').update(stableStringify({ ...packageWithoutManifest, manifest: base })).digest('hex');
  return { ...base, timestamp, checksum };
}

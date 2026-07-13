import { RuntimeManifest } from './types.ts';

export const RUNTIME_VERSION = '1.0.0';

export function buildRuntimeManifest(args: { runtimeAdapter: string; model: string; executionStart: string; executionEnd: string; tokens: { input: number | null; output: number | null }; schemaValidation: 'passed' | 'failed'; packageChecksum: string; }): RuntimeManifest {
  const start = new Date(args.executionStart).getTime();
  const end = new Date(args.executionEnd).getTime();
  return { runtimeVersion: RUNTIME_VERSION, runtimeAdapter: args.runtimeAdapter, model: args.model, executionStart: args.executionStart, executionEnd: args.executionEnd, latencyMs: end - start, tokens: args.tokens, schemaValidation: args.schemaValidation, packageChecksum: args.packageChecksum };
}

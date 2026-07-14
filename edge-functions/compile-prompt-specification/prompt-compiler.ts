// prompt-compiler.ts
//
// Orchestrates PSC-001 through PSC-008 in order. Never calls a
// model. Never generates content. Its only output is a Prompt
// Package -- data, not an executed result.

import { ExecutionSpecification } from './execution-schema.ts';
import { TargetRuntime, PromptPackage } from './prompt-schema.ts';
import { PromptCompileResult, PromptCompileIssue } from './types.ts';
import { checkExecutionSpecificationShape, verifyProvenance } from './manifest.ts';
import { buildPromptSpecification, buildExecutionConstraints } from './prompt-builder.ts';
import { buildOutputSchema } from './output-schema.ts';
import { buildValidationInstructions } from './validation-builder.ts';
import { buildPromptManifest } from './prompt-manifest.ts';

const SUPPORTED_RUNTIMES: TargetRuntime[] = ['claude', 'gpt', 'gemini'];

const FORBIDDEN_LEAKAGE_STRINGS = ['Editorial Contract', 'Commercial Constitution', 'Positioning Reference'];

function checkNoLeakage(serialized: string): PromptCompileIssue[] {
  const issues: PromptCompileIssue[] = [];
  for (const term of FORBIDDEN_LEAKAGE_STRINGS) {
    if (serialized.includes(term)) {
      issues.push({
        reason: 'compiler_internal_error',
        field: '(serialized package)',
        message: `Prompt Package contains the forbidden governance-document reference "${term}".`,
      });
    }
  }
  return issues;
}

export function compilePromptSpecification(input: unknown, targetRuntime: unknown): PromptCompileResult {
  if (typeof targetRuntime !== 'string' || !SUPPORTED_RUNTIMES.includes(targetRuntime as TargetRuntime)) {
    return {
      status: 'failed',
      issues: [{ reason: 'unsupported_runtime', field: 'targetRuntime', message: `"${targetRuntime}" is not a supported runtime. Expected one of: ${SUPPORTED_RUNTIMES.join(', ')}.` }],
    };
  }
  const runtime = targetRuntime as TargetRuntime;

  const shapeIssues = checkExecutionSpecificationShape(input);
  if (shapeIssues.length > 0) {
    return { status: 'failed', issues: shapeIssues };
  }
  const es = input as ExecutionSpecification;

  const provenanceIssues = verifyProvenance(es);
  if (provenanceIssues.length > 0) {
    return { status: 'failed', issues: provenanceIssues };
  }

  const promptSpecification = buildPromptSpecification(es, runtime);
  const executionConstraints = buildExecutionConstraints(es);
  const outputSchema = buildOutputSchema(es);
  const validationInstructions = buildValidationInstructions(es);

  const packageWithoutManifest: Omit<PromptPackage, 'manifest'> = {
    promptSpecification,
    outputSchema,
    validationInstructions,
    executionConstraints,
  };

  const leakageIssues = checkNoLeakage(JSON.stringify(packageWithoutManifest));
  if (leakageIssues.length > 0) {
    return { status: 'failed', issues: leakageIssues };
  }

  const manifest = buildPromptManifest(es, runtime, packageWithoutManifest);

  return { status: 'compiled', promptPackage: { ...packageWithoutManifest, manifest } };
}

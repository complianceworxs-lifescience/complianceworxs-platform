import { sha256 } from './checksum-util.ts';
import { PipelineManifest } from './types.ts';

export function buildPipelineManifest(args: {
  executionSpecification: { compiler: { architectureVersion: string; compilerVersion: string; ruleRegistryVersion: string; checksum: string } };
  promptPackage: { manifest: { promptCompilerVersion: string; checksum: string } };
  runtimeManifest: { runtimeVersion: string; model: string; packageChecksum: string };
  validationManifest: { deterministicEngineVersion: string; editorialReviewEngineVersion: string; checksum: string };
  contractId: string;
}): PipelineManifest {
  const base = {
    architectureVersion: args.executionSpecification.compiler.architectureVersion,
    compilerVersion: args.executionSpecification.compiler.compilerVersion,
    promptCompilerVersion: args.promptPackage.manifest.promptCompilerVersion,
    runtimeVersion: args.runtimeManifest.runtimeVersion,
    deterministicEngineVersion: args.validationManifest.deterministicEngineVersion,
    editorialReviewEngineVersion: args.validationManifest.editorialReviewEngineVersion,
    model: args.runtimeManifest.model,
    contractId: args.contractId,
    executionSpecChecksum: args.executionSpecification.compiler.checksum,
    promptPackageChecksum: args.promptPackage.manifest.checksum,
    validationChecksum: args.validationManifest.checksum,
  };
  const pipelineChecksum = sha256([base.executionSpecChecksum, base.promptPackageChecksum, base.validationChecksum, base.contractId]);
  return { ...base, pipelineChecksum };
}

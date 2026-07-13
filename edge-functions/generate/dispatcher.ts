import { OrchestratorRequest } from './types.ts';
import { buildExecutiveBriefContract } from './executive-brief-contract-builder.ts';

type ContractBuilder = (input: any) => Record<string, unknown>;

const ASSET_CONTRACT_BUILDERS: Record<string, ContractBuilder> = {
  executive_brief: buildExecutiveBriefContract,
};

export function selectContractBuilder(assetType: string): ContractBuilder | null {
  return ASSET_CONTRACT_BUILDERS[assetType] ?? null;
}

export function buildContractForRequest(request: OrchestratorRequest): { contract: Record<string, unknown> } | { error: string } {
  const builder = selectContractBuilder(request.assetType);
  if (!builder) {
    return { error: `Unsupported assetType "${request.assetType}". Supported: [${Object.keys(ASSET_CONTRACT_BUILDERS).join(', ')}].` };
  }
  return { contract: builder(request) };
}

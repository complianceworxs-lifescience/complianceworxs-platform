import { PipelineState } from './types.ts';

export const PIPELINE_SEQUENCE: PipelineState[] = [
  'RECEIVED', 'VALIDATED', 'COMPILED', 'PROMPT_READY',
  'EXECUTING', 'STRUCTURAL_VALIDATION', 'EDITORIAL_REVIEW', 'COMPLETED',
];

export function nextState(current: PipelineState): PipelineState {
  const idx = PIPELINE_SEQUENCE.indexOf(current);
  if (idx === -1 || idx === PIPELINE_SEQUENCE.length - 1) {
    throw new Error(`No forward transition defined from state "${current}".`);
  }
  return PIPELINE_SEQUENCE[idx + 1];
}

export const FAILED_STATE: PipelineState = 'FAILED';

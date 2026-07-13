import { sha256 } from './checksum-util.ts';
import { StageLogEntry, PipelineState } from './types.ts';

export function startStage(): number {
  return Date.now();
}

export function recordStage(
  stage: string,
  state: PipelineState,
  status: 'ok' | 'failed',
  startedAt: number,
  input: unknown,
  output: unknown,
): StageLogEntry {
  return {
    stage,
    state,
    status,
    durationMs: Date.now() - startedAt,
    inputChecksum: sha256(input),
    outputChecksum: status === 'ok' ? sha256(output) : null,
  };
}

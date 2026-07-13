import { createHash } from 'node:crypto';
import { stableStringify } from './checksum-util.ts';
import { DeterministicResult, EditorialReview, ValidationManifest } from './types.ts';

export const DETERMINISTIC_ENGINE_VERSION = '1.0.0';
export const EDITORIAL_REVIEW_ENGINE_VERSION = '1.0.0';

export function buildValidationManifest(
  sourceExecutionSpecificationId: string,
  promptPackageChecksum: string,
  deterministic: DeterministicResult,
  editorialReview: EditorialReview | null,
): ValidationManifest {
  const timestamp = new Date().toISOString();
  const base = { deterministicEngineVersion: DETERMINISTIC_ENGINE_VERSION, editorialReviewEngineVersion: EDITORIAL_REVIEW_ENGINE_VERSION, sourceExecutionSpecificationId, promptPackageChecksum };
  const checksum = createHash('sha256').update(stableStringify({ deterministic, editorialReview, manifest: base })).digest('hex');
  return { ...base, timestamp, checksum };
}

import { BatchReviewRequest } from './types.ts';

export interface ServiceValidationIssue { field: string; message: string; }

export function validateBatchReviewRequest(input: unknown): { valid: true; request: BatchReviewRequest } | { valid: false; issues: ServiceValidationIssue[] } {
  const issues: ServiceValidationIssue[] = [];
  if (typeof input !== 'object' || input === null) {
    return { valid: false, issues: [{ field: '(root)', message: 'Request body must be an object.' }] };
  }
  const body = input as Record<string, unknown>;

  for (const field of ['decisionDomain', 'submittedMaterial'] as const) {
    if (typeof body[field] !== 'string' || (body[field] as string).trim().length === 0) {
      issues.push({ field, message: `"${field}" is required and must be a non-empty string.` });
    }
  }
  if (!Array.isArray(body.submittedDocuments) || body.submittedDocuments.length === 0 || !body.submittedDocuments.every((d) => typeof d === 'string')) {
    issues.push({ field: 'submittedDocuments', message: '"submittedDocuments" is required and must be a non-empty array of strings.' });
  }
  if (body.assetType !== 'batch_review') {
    issues.push({ field: 'assetType', message: 'This service only accepts assetType "batch_review".' });
  }

  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, request: body as unknown as BatchReviewRequest };
}

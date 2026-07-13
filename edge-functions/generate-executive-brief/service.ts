// service.ts

import { ExecutiveBriefRequest } from './types.ts';

export interface ServiceValidationIssue { field: string; message: string; }

export function validateExecutiveBriefRequest(input: unknown): { valid: true; request: ExecutiveBriefRequest } | { valid: false; issues: ServiceValidationIssue[] } {
  const issues: ServiceValidationIssue[] = [];
  if (typeof input !== 'object' || input === null) {
    return { valid: false, issues: [{ field: '(root)', message: 'Request body must be an object.' }] };
  }
  const body = input as Record<string, unknown>;

  for (const field of ['topic', 'audience', 'commercialObjective', 'sourceMaterial'] as const) {
    if (typeof body[field] !== 'string' || (body[field] as string).trim().length === 0) {
      issues.push({ field, message: `"${field}" is required and must be a non-empty string.` });
    }
  }
  if (body.assetType !== 'executive_brief') {
    issues.push({ field: 'assetType', message: 'This service only accepts assetType "executive_brief".' });
  }

  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, request: body as unknown as ExecutiveBriefRequest };
}

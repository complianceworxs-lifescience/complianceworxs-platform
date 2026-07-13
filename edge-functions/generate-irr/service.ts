import { IrrRequest, Industry } from './types.ts';

export interface ServiceValidationIssue { field: string; message: string; }

const VALID_INDUSTRIES: Industry[] = ['pharma', '503b', 'food', 'cosmetics'];
const REQUIRED_STRING_FIELDS = ['decisionDescription', 'audience', 'evidenceSummary', 'riskContext', 'decisionOwner', 'authorizationDate'] as const;

export function validateIrrRequest(input: unknown): { valid: true; request: IrrRequest } | { valid: false; issues: ServiceValidationIssue[] } {
  const issues: ServiceValidationIssue[] = [];
  if (typeof input !== 'object' || input === null) {
    return { valid: false, issues: [{ field: '(root)', message: 'Request body must be an object.' }] };
  }
  const body = input as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof body[field] !== 'string' || (body[field] as string).trim().length === 0) {
      issues.push({ field, message: `"${field}" is required and must be a non-empty string.` });
    }
  }

  if (typeof body.industry !== 'string' || body.industry.trim().length === 0) {
    issues.push({ field: 'industry', message: `"industry" is required. Must be one of: ${VALID_INDUSTRIES.join(', ')}.` });
  } else if (!VALID_INDUSTRIES.includes(body.industry as Industry)) {
    issues.push({ field: 'industry', message: `"industry" value "${body.industry}" is not recognized. Must be exactly one of: ${VALID_INDUSTRIES.join(', ')}. No default is applied.` });
  }

  if (body.assetType !== 'inspection_response_record') {
    issues.push({ field: 'assetType', message: 'This service only accepts assetType "inspection_response_record".' });
  }

  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, request: body as unknown as IrrRequest };
}

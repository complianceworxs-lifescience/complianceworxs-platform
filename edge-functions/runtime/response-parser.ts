export interface ParseResult { parsed: Record<string, unknown> | null; parseError: string | null; }

export function parseModelOutput(textContent: string): ParseResult {
  const fenceStripped = textContent.replace(/```json|```/g, '').trim();
  const firstBrace = fenceStripped.indexOf('{');
  const lastBrace = fenceStripped.lastIndexOf('}');
  const clean = (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) ? fenceStripped.slice(firstBrace, lastBrace + 1) : fenceStripped;
  try {
    const parsed = JSON.parse(clean);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { parsed: null, parseError: 'Parsed value is not a JSON object.' };
    return { parsed, parseError: null };
  } catch (err) {
    return { parsed: null, parseError: `Model output was not valid JSON: ${(err as Error).message}` };
  }
}

export function normalizeStringArray(input: string[]): string[] {
  return Array.from(new Set(input.map((s) => s.trim()))).sort();
}

export function splitAndNormalizeByPrefix(ids: string[], matchers: Record<string, (id: string) => boolean>): Record<string, string[]> {
  const buckets: Record<string, string[]> = {};
  for (const key of Object.keys(matchers)) buckets[key] = [];
  for (const id of ids) { for (const [key, matches] of Object.entries(matchers)) { if (matches(id)) buckets[key].push(id); } }
  for (const key of Object.keys(buckets)) { buckets[key] = normalizeStringArray(buckets[key]); }
  return buckets;
}

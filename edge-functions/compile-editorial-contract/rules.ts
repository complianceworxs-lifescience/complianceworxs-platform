export type RuleCategory = 'EP' | 'EV' | 'RG' | 'RS' | 'ES' | 'NP' | 'EC' | 'AS' | 'EDE' | 'EQS' | 'EG' | 'AIB' | 'INV' | 'FM' | 'AC' | 'QG' | 'CL' | 'STATE';
export interface RuleEntry { id: string; category: RuleCategory; chapter: number; chapterTitle: string; }
export const CHAPTER_TITLES: Record<number, string> = { 1: 'Editorial Philosophy', 2: 'Editorial Voice', 3: 'Reasoning Grammar', 4: 'Reasoning Standards', 5: 'Evidence Standards', 6: 'Narrative Patterns', 7: 'Editorial Contracts', 8: 'Asset Contracts', 9: 'Editorial Decision Engine', 10: 'Editorial Quality System', 11: 'Editorial Governance', 12: 'AI Implementation Boundary', 13: 'Appendices' };

function ids(prefix: string, count: number, pad = 3): string[] { return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(pad, '0')}`); }
function idsNoSep(prefix: string, count: number, pad = 3): string[] { return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(pad, '0')}`); }

const registryRows: Array<[string, RuleCategory, number]> = [
  ...ids('EP', 8).map((id): [string, RuleCategory, number] => [id, 'EP', 1]),
  ...ids('INV-EP', 5).map((id): [string, RuleCategory, number] => [id, 'INV', 1]),
  ...ids('FM-EP', 5).map((id): [string, RuleCategory, number] => [id, 'FM', 1]),
  ...ids('AC-EP', 4).map((id): [string, RuleCategory, number] => [id, 'AC', 1]),
  ...ids('EV', 10).map((id): [string, RuleCategory, number] => [id, 'EV', 2]),
  ...ids('IV-EV', 3).map((id): [string, RuleCategory, number] => [id, 'INV', 2]),
  ...ids('FM-EV', 4).map((id): [string, RuleCategory, number] => [id, 'FM', 2]),
  ...ids('AC-EV', 4).map((id): [string, RuleCategory, number] => [id, 'AC', 2]),
  ...ids('RG', 10).map((id): [string, RuleCategory, number] => [id, 'RG', 3]),
  ...ids('RM', 5).map((id): [string, RuleCategory, number] => [id, 'RG', 3]),
  ...ids('PF', 5).map((id): [string, RuleCategory, number] => [id, 'RG', 3]),
  ...ids('INV-RG', 3).map((id): [string, RuleCategory, number] => [id, 'INV', 3]),
  ...ids('FM-RG', 5).map((id): [string, RuleCategory, number] => [id, 'FM', 3]),
  ...ids('AC-RG', 4).map((id): [string, RuleCategory, number] => [id, 'AC', 3]),
  ...['RS-P1', 'RS-P2', 'RS-P3', 'RS-P4', 'RS-P5', 'RS-P6', 'RS-P7'].map((id): [string, RuleCategory, number] => [id, 'RS', 4]),
  ...ids('RS', 10).map((id): [string, RuleCategory, number] => [id, 'RS', 4]),
  ...ids('QG', 5).map((id): [string, RuleCategory, number] => [id, 'QG', 4]),
  ...ids('INV-RS', 4).map((id): [string, RuleCategory, number] => [id, 'INV', 4]),
  ...ids('FM-RS', 6).map((id): [string, RuleCategory, number] => [id, 'FM', 4]),
  ...ids('AC-RS', 5).map((id): [string, RuleCategory, number] => [id, 'AC', 4]),
  ...['ES-M1', 'ES-M2', 'ES-M3', 'ES-M4', 'ES-M5', 'ES-M6'].map((id): [string, RuleCategory, number] => [id, 'ES', 5]),
  ...['EC-1', 'EC-2', 'EC-3', 'EC-4', 'EC-5'].map((id): [string, RuleCategory, number] => [id, 'ES', 5]),
  ...ids('ES', 10).map((id): [string, RuleCategory, number] => [id, 'ES', 5]),
  ...ids('EQG', 7).map((id): [string, RuleCategory, number] => [id, 'ES', 5]),
  ...ids('INV-ES', 4).map((id): [string, RuleCategory, number] => [id, 'INV', 5]),
  ...ids('FM-ES', 6).map((id): [string, RuleCategory, number] => [id, 'FM', 5]),
  ...ids('AC-ES', 5).map((id): [string, RuleCategory, number] => [id, 'AC', 5]),
  ...['NP-S1', 'NP-S2', 'NP-S3', 'NP-S4', 'NP-S5', 'NP-S6', 'NP-S7'].map((id): [string, RuleCategory, number] => [id, 'NP', 6]),
  ...ids('NP', 6).map((id): [string, RuleCategory, number] => [id, 'NP', 6]),
  ...ids('NC', 6).map((id): [string, RuleCategory, number] => [id, 'NP', 6]),
  ...ids('INV-NP', 3).map((id): [string, RuleCategory, number] => [id, 'INV', 6]),
  ...ids('FM-NP', 5).map((id): [string, RuleCategory, number] => [id, 'FM', 6]),
  ...ids('AC-NP', 4).map((id): [string, RuleCategory, number] => [id, 'AC', 6]),
  ...ids('ECS', 13).map((id): [string, RuleCategory, number] => [id, 'EC', 7]),
  ...ids('EC', 10).map((id): [string, RuleCategory, number] => [id, 'EC', 7]),
  ...ids('CL', 7).map((id): [string, RuleCategory, number] => [id, 'CL', 7]),
  ...ids('INV-EC', 4).map((id): [string, RuleCategory, number] => [id, 'INV', 7]),
  ...ids('FM-EC', 6).map((id): [string, RuleCategory, number] => [id, 'FM', 7]),
  ...ids('AC-EC', 5).map((id): [string, RuleCategory, number] => [id, 'AC', 7]),
  ...ids('ACM', 11).map((id): [string, RuleCategory, number] => [id, 'AS', 8]),
  ...ids('AF', 8).map((id): [string, RuleCategory, number] => [id, 'AS', 8]),
  ...ids('AS', 10).map((id): [string, RuleCategory, number] => [id, 'AS', 8]),
  ...ids('INV-AS', 4).map((id): [string, RuleCategory, number] => [id, 'INV', 8]),
  ...ids('FM-AS', 5).map((id): [string, RuleCategory, number] => [id, 'FM', 8]),
  ...ids('AC-AS', 5).map((id): [string, RuleCategory, number] => [id, 'AC', 8]),
  ...idsNoSep('EDE-O', 5).map((id): [string, RuleCategory, number] => [id, 'EDE', 9]),
  ...idsNoSep('EDE-S', 9).map((id): [string, RuleCategory, number] => [id, 'EDE', 9]),
  ...idsNoSep('EDE-CR', 5).map((id): [string, RuleCategory, number] => [id, 'EDE', 9]),
  ...ids('STATE', 7).map((id): [string, RuleCategory, number] => [id, 'STATE', 9]),
  ...ids('EDE-D', 4).map((id): [string, RuleCategory, number] => [id, 'EDE', 9]),
  ...ids('FM-EDE', 6).map((id): [string, RuleCategory, number] => [id, 'FM', 9]),
  ...ids('AC-EDE', 5).map((id): [string, RuleCategory, number] => [id, 'AC', 9]),
  ...idsNoSep('EQS-O', 5).map((id): [string, RuleCategory, number] => [id, 'EQS', 10]),
  ...idsNoSep('EQS-S', 7).map((id): [string, RuleCategory, number] => [id, 'EQS', 10]),
  ...['QG-100', 'QG-110', 'QG-120', 'QG-130', 'QG-140', 'QG-150', 'QG-160', 'QG-170'].map((id): [string, RuleCategory, number] => [id, 'QG', 10]),
  ...ids('EQS', 8).map((id): [string, RuleCategory, number] => [id, 'EQS', 10]),
  ...ids('REG', 4).map((id): [string, RuleCategory, number] => [id, 'EQS', 10]),
  ...ids('FM-EQS', 5).map((id): [string, RuleCategory, number] => [id, 'FM', 10]),
  ...ids('AC-EQS', 5).map((id): [string, RuleCategory, number] => [id, 'AC', 10]),
  ...ids('EG', 5).map((id): [string, RuleCategory, number] => [id, 'EG', 11]),
  ...idsNoSep('EG-A', 6).map((id): [string, RuleCategory, number] => [id, 'EG', 11]),
  ...idsNoSep('EG-C', 5).map((id): [string, RuleCategory, number] => [id, 'EG', 11]),
  ...idsNoSep('EG-X', 4).map((id): [string, RuleCategory, number] => [id, 'EG', 11]),
  ...ids('INV-EG', 3).map((id): [string, RuleCategory, number] => [id, 'INV', 11]),
  ...ids('FM-EG', 5).map((id): [string, RuleCategory, number] => [id, 'FM', 11]),
  ...ids('AC-EG', 4).map((id): [string, RuleCategory, number] => [id, 'AC', 11]),
  ...ids('AIB', 5).map((id): [string, RuleCategory, number] => [id, 'AIB', 12]),
  ...['AIB-101', 'AIB-102', 'AIB-103', 'AIB-104', 'AIB-105'].map((id): [string, RuleCategory, number] => [id, 'AIB', 12]),
  ...['AIB-201', 'AIB-202', 'AIB-203', 'AIB-204'].map((id): [string, RuleCategory, number] => [id, 'AIB', 12]),
  ...ids('INV-AIB', 3).map((id): [string, RuleCategory, number] => [id, 'INV', 12]),
  ...ids('FM-AIB', 4).map((id): [string, RuleCategory, number] => [id, 'FM', 12]),
  ...ids('AC-AIB', 4).map((id): [string, RuleCategory, number] => [id, 'AC', 12]),
  ...ids('APP', 4).map((id): [string, RuleCategory, number] => [id, 'AC', 13]),
  ...['APP-101', 'APP-102', 'APP-103'].map((id): [string, RuleCategory, number] => [id, 'AC', 13]),
];

export const RULE_REGISTRY: Record<string, RuleEntry> = {};
for (const [id, category, chapter] of registryRows) { RULE_REGISTRY[id] = { id, category, chapter, chapterTitle: CHAPTER_TITLES[chapter] }; }

export function ruleExists(id: string): boolean { return Object.prototype.hasOwnProperty.call(RULE_REGISTRY, id); }
export function ruleCategory(id: string): RuleCategory | null { return RULE_REGISTRY[id]?.category ?? null; }
export function ruleBelongsToChapter(id: string, chapter: number): boolean { return RULE_REGISTRY[id]?.chapter === chapter; }
export function chapterExists(name: string): boolean {
  const normalized = name.replace(/^chapter\s*/i, '').trim();
  const num = Number(normalized);
  if (!Number.isNaN(num)) return CHAPTER_TITLES[num] !== undefined;
  return Object.values(CHAPTER_TITLES).some((t) => t.toLowerCase() === name.toLowerCase());
}

export const RULE_REGISTRY_VERSION = '2.0.0';
export const NARRATIVE_PATTERN_SEQUENCES: Record<string, string[]> = {
  'NP-001': ['Problem', 'Cause', 'Consequence', 'Resolution'],
  'NP-002': ['Observation', 'Evidence', 'Interpretation', 'Recommendation'],
  'NP-003': ['Question', 'Analysis', 'Decision', 'Justification'],
  'NP-004': ['Current State', 'Constraint', 'Future State'],
  'NP-005': ['Risk', 'Exposure', 'Control', 'Residual Risk'],
  'NP-006': ['Case', 'Analysis', 'General Principle'],
};

export function ruleIdsForChapter(chapter: number): string[] { return Object.values(RULE_REGISTRY).filter((r) => r.chapter === chapter).map((r) => r.id); }
export function parseChapterRef(ref: string): number | null {
  const m = ref.match(/^chapter\s*(\d+)$/i);
  if (m) return Number(m[1]);
  for (const [num, title] of Object.entries(CHAPTER_TITLES)) { if (title.toLowerCase() === ref.toLowerCase()) return Number(num); }
  return null;
}
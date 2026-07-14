import { CompileIssue } from './types.ts';
import { ruleExists, ruleIdsForChapter, parseChapterRef } from './rules.ts';
import { normalizeStringArray } from './normalizer.ts';

export interface ResolvedInheritance { declaredInheritance: string[]; resolvedRuleIds: string[]; issues: CompileIssue[]; }

export function resolveInheritanceClosure(inheritsFrom: string[]): ResolvedInheritance {
  const issues: CompileIssue[] = [];
  const resolved = new Set<string>();
  for (const ref of inheritsFrom) {
    const chapterNum = parseChapterRef(ref);
    if (chapterNum !== null) {
      const idsInChapter = ruleIdsForChapter(chapterNum);
      if (idsInChapter.length === 0) {
        issues.push({ reason: 'unknown_chapter_reference', field: 'traceability.inheritsFrom', ruleRef: ref, message: `"${ref}" resolved to chapter ${chapterNum}, but no rules are registered under that chapter.` });
        continue;
      }
      idsInChapter.forEach((id) => resolved.add(id));
      continue;
    }
    if (ruleExists(ref)) { resolved.add(ref); }
    else { issues.push({ reason: 'unknown_chapter_reference', field: 'traceability.inheritsFrom', ruleRef: ref, message: `"${ref}" is not a known chapter or rule ID.` }); }
  }
  return { declaredInheritance: normalizeStringArray(inheritsFrom), resolvedRuleIds: normalizeStringArray(Array.from(resolved)), issues };
}

export function checkCitationsAreInherited(citedRuleIds: string[], resolvedClosure: string[], fieldName: string): CompileIssue[] {
  const closureSet = new Set(resolvedClosure);
  const issues: CompileIssue[] = [];
  for (const id of citedRuleIds) {
    if (!closureSet.has(id)) {
      issues.push({ reason: 'unresolved_inheritance', field: fieldName, ruleRef: id, message: `Rule "${id}" is cited in ${fieldName} but is not covered by any declared entry in traceability.inheritsFrom.` });
    }
  }
  return issues;
}

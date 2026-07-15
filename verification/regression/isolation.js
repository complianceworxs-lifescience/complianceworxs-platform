// M7-11 — regression isolation (DR §17).
//
// Run membership is defined EXCLUSIVELY by the corpus index's case_id set — a content-
// addressed, in-repo artifact — never by "rows in a production table within a time
// window." Nothing in this module reads a database, a clock-window, or any production
// job table; membership is a pure function of the committed corpus index (N-07 / A-M4).
import { createHash, randomUUID } from 'node:crypto';

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// A fresh, unique, attributable run identifier (A-M3 / N-08). Not derived from, and not
// persisted into, any production table.
export function newRunId() {
  return randomUUID();
}

// Content-address the whole corpus: sha256 over the sorted "case_id:file_hash" lines.
// A changed input (new file hash) or an added/removed case changes this hash, so a run is
// attributable to an exact corpus version (N-06 / N-08).
export function computeCorpusHash(caseHashes) {
  const body = Object.keys(caseHashes).sort().map((id) => `${id}:${caseHashes[id]}`).join('\n');
  return sha256Hex(Buffer.from(body, 'utf8'));
}

// Membership = the corpus index case_id set. Explicitly corpus-scoped; takes no DB handle,
// no time window, no production input.
export function selectMembership(index) {
  return {
    source: 'corpus-index (content-addressed; no production-table time window)',
    corpus_version: index.corpus_version,
    corpus_hash: index.corpus_hash,
    case_ids: Object.keys(index.cases).sort(),
  };
}

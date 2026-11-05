# CWOS Execution Register

Generated 2026-11-05. Read-only audit. Baseline `docs/CWOS_Execution_Register.docx` was **not found** in any reachable repo or Drive; this register is built from live sources, not from the baseline. Columns follow the baseline spec.

## Sources and coverage

| Source | Result |
|---|---|
| GitHub `complianceworxs-astro` | 2,339 issues/PRs (2,060 PRs: 1,977 merged, 55 closed unmerged). 2,166 created in the last 90 days (since 2026-08-07). Head `5cafcf1` (2026-11-04). |
| GitHub `complianceworxs-platform` | 9 items (7 PRs merged, 1 open issue #7, 1 closed issue). 4 in window. |
| GitHub `cw-inspection-case-files` | 31 items. 27 in window. Open: #13, #14 (issues), #17 (PR). |
| GitHub `cw-authorization-record` | **Not reachable.** Not in the org repo list available to this session. A Vercel project of that name exists. Issues/PRs not inventoried. |
| Vercel | astro: last production deploy 2026-11-04 16:38 UTC, READY, commit `5cafcf1` (D-202). case-files: 2026-10-08 15:41 UTC, READY, commit `e28a0aa` (#31). cw-authorization-record: 2026-09-03 12:37 UTC, READY, commit `80b6620`. A same-day deploy of `57e0c14` (#2335) was CANCELED, superseded by `5777af5`/`5cafcf1`. |
| Supabase `complianceworxs` | `cwos_work_register` 63 rows (30 active, 1 blocked, 32 complete). `cw_outcome_status` 49 rows (11 blocked, 1 executing, 1 no_execution_path, 5 verification pending, 19 verification not_due, 12 queued). `cwos_agent_work_candidates` (12 blocked, 24 verification_pending, 13 eligible, 249 completed, 205 superseded). `cw_capability_verification_queue` 7 rows (1 BLOCKED, 1 FAILED, 5 DEFERRED). `cw_durable_outcomes` 1 row. |
| Stripe | Queried 2026-11-05, live mode, account ComplianceWorxs (`GetCharges`, 3 charges, no more pages). `ch_3TFRWP…` $149 succeeded 2026-03-26 (external buyer, Apple Pay). `py_3TJ1II…` $27 succeeded 2026-04-05 (external buyer, Link). `ch_3UMucw…` $75 FAILED (live-mode test card, founder test email). No $497 charge, no refunds, no disputes. |
| PostHog | Queried 2026-11-05 (HogQL, last 90 days). `irr_sample_page_viewed` 301, `irr_checkout_started` 33, `irr_purchase_intake_submitted` 25, `irr_purchase_completed` 13. All six $497 completions (2026-08-25, 2026-09-04) carry `cs_test_` Stripe sessions and `test=1`; the other seven are `cw_verify` on 127.0.0.1:4400 or post-purchase intake (one from a Vercel preview host). No live-mode completion found. |

Mapping: every in-window item is assigned to a workstream row in `CWOS_Execution_Register_item_map.csv` (repo, number, kind, state, dates, workstream). Item-to-workstream assignment is by title rules, not by reading each item; WS-16 is a broad, low-confidence grouping; 45 items remain in WS-99, reviewed by title and treated as noise. The map carries owner (by workstream), assignee (GitHub; mostly empty) and `#NNN` references found in the title as linked_refs; linked PRs from item bodies were not extracted.

## Business verification

No row is Business-verified. Source: `cw_order` has 12 rows, all `is_test=true`; zero non-test orders. Stripe live mode confirms: no $497 charge has ever been made (two external payments, $149 and $27, both before 2026-04-06). PostHog agrees: no `irr_purchase_completed` event comes from a live-mode Stripe session. Governing objective (first attributable external paid $497 IRR order) is unmet.

## Register

Stage scale: Specified, Implemented, Merged, Deployed, Production-verified, Business-verified. "Deployed" means merged to `main` and the production deploy at `5cafcf1` is READY; it does not mean the behavior was exercised in production.

| Assignment | Owner | Authority/source | Stage reached | Verified outcome/gap |
|---|---|---|---|---|
| WS-01 Learning Series | Coordinator | D-193 (Jon, 2026-11-03); #2294-#2298 | Merged -> Deployed (hub and Unit 1 are preview, gated) (In progress); 7 (7 merged PR, 0 closed issue, 0 open, 0 closed unmerged) | Deployed. Work register shows active Coordinator intake rows (fba2a30c, bc5eb079, 91d4cc0d, d3ccfc4d, f735c369, 3e3c635a), none with verified_at. No enrollment, traffic or revenue read exists. Gap: no outcome evidence. |
| WS-02 Eight-week commercial operating program | Coordinator | #2334 (open); D-202 (Jon, 2026-11-04); PR #2337 | Merged -> Deployed (decision record and intake only) (In progress); 2 (1 merged PR, 0 closed issue, 1 open, 0 closed unmerged) | D-202 deployed 2026-11-04 (prod dpl_Ai6asaVB4nBtBN1BCWm719QtARum). Work register row 871ada7b active, no verified_at. Program itself not executed. Gap: no outcome measure read. |
| WS-03 Content Studio (commercialization) | Marketing | #2151 (open), #1714-#1727; D-108, D-109 | Deployed (preview page, noindex; inquiry receiver connected) (In progress); 26 (25 merged PR, 0 closed issue, 1 open, 0 closed unmerged) | Work register a8e31c3b (Marketing) active; evidence field names acknowledgement, preview test and inquiry receiver. $2,500 three-format pilot is approval-gated. No paid pilot or inquiry-to-revenue record found. Gap: commercialization not evidenced. |
| WS-04 SEO / search visibility | Growth | #1163, #1302, #1972 (open); #730-#736 and 70+ PRs | Deployed (technical SEO fixes); repair loop open (In progress); 80 (67 merged PR, 8 closed issue, 3 open, 2 closed unmerged) | Open: #1163 (no activity 32 days), #1302 (Semrush crawl discovery, 9 routes), #1972 (third-party credibility signal). Blocked outcome in Supabase: candidate b6b0eaf5 'Search authority', verification_overdue. Gap: no ranking, impression or traffic read tied to these changes in this audit. |
| WS-05 Magazine, Insights, articles | Marketing | #1959, #1639, #1641, #2050 (open); work register 21e54028, 6526feac | Merged -> Deployed; Issue 03 and two article drafts open (In progress); 129 (116 merged PR, 2 closed issue, 7 open, 4 closed unmerged) | Work register 21e54028 (Marketing) active. #1959 open (verify sources, restore article). PRs #1643/#1644 open drafts. Gap: no readership or conversion evidence. |
| WS-06 CW-MDR-009 IRR examination (E0-E7) | Product | #1778-#1804, #1828, #2201, #2079; PR #1779; D-120 | E1 Merged (#1780); E0b partially Merged; E2-E7 Specified (Blocked); 41 (28 merged PR, 3 closed issue, 9 open, 1 closed unmerged) | See conflict 5. E0b addendum PR #1779 open since 2026-10-22. #1828 blocks E6/E7 on protected Supabase workflow access. Work register 1d8aaa26 active. Gap: examination feature off, no production run. |
| WS-07 IRR product, checkout, credit, fulfillment, Stripe | Product | #595, #1819, #1824, #1970, #2239 (open); D-050, D-057, D-082 | Deployed (page, checkout, webhook, fulfillment code) (Completed (not verified)); 336 (287 merged PR, 32 closed issue, 11 open, 6 closed unmerged) | Supabase cw_order: 12 rows, all is_test=true (5 payment_confirmed test rows). Zero non-test orders. PR #1779 text records Stripe live-mode: three charges ever, none $497 (not re-read this session; Stripe MCP not authorized). Capability queue VP-04-PAYMENT FAILED (SLA expired 2026-08-30). Open conflict #1824 (credit window). Gap: no externally initiated paid $497 order. |
| WS-08 Case Files | Product | #2172 (open); case-files #13, #14, #17 (open); D-050, D-058 | Deployed (astro 2026-11-04; case-files prod 2026-10-08) (Completed (not verified)); 123 (115 merged PR, 4 closed issue, 3 open, 1 closed unmerged) | Case-files prod deploy 2026-10-08 removed Attio and added $149 credit CTA (#31). No Case File purchase read in this audit. Case-files #13/#14 are duplicates, no activity since 2026-08-18. Gap: no sales evidence. |
| WS-09 Outbound, LinkedIn, prospect supply | Revenue | #631, #2202, #2203, #2270, #2311, #2338 (open); D-055, D-056, D-079, D-081, D-139 | Deployed (dispatch, replies, gating) (Blocked); 201 (152 merged PR, 36 closed issue, 6 open, 7 closed unmerged) | Six Growth outcomes blocked in Supabase: three unresolved_ambiguous_provider_outcome (dispatch), one route_worker_check_failed, one held_by_executor (draft misdescribes Issue 03), one verification_overdue. Work register Revenue 62b4a3a0 and 92cbae01 active. Gap: no attributable external engagement converted. |
| WS-10 Attio retirement | Operations | D-057; REC-006; PRs under 'attio' | Deployed; Production-verified per work register (REC-006 verified_at 2026-09-15, sender-v74) (Completed (not verified)); 24 (16 merged PR, 7 closed issue, 0 open, 1 closed unmerged) | Verified_at is executor-recorded; not re-read independently. Legacy docs/attio-*.md remain in astro (see conflict 2). Gap: leftover docs, Supabase function format_lead_for_mailerlite still flagged. |
| WS-11 Homepage, navigation, brand copy | Product | #2239 (open); PRs #992, #1550, #1586, #1631, #1673, #1744, #1761, #1883, #1918 (open) | Deployed (merged); 7 PRs open, several are drafts held for founder review (In progress); 230 (213 merged PR, 4 closed issue, 7 open, 6 closed unmerged) | #1918 is a prepared change not to merge before 2026-11-06 17:03 UTC. #1586 and #1744 are marked do-not-merge drafts. Gap: homepage conversion intervention (#2239) has no read. |
| WS-12 DDA / assessment / Decision Reconstruction | Product | platform #7 (open); D-056, D-058; work register c0e0c606 (Measurement) | Deployed (DDA retained as site entry point; frozen as front door) (Completed (not verified)); 90 (67 merged PR, 17 closed issue, 1 open, 5 closed unmerged) | Platform #7 (Phase 2 Production Gate, DDA qualitative summary) open, no activity 73 days. Work register 46b77ed8 and e7d9a0dc marked complete offline on controlled-test records. Gap: no external buyer path read. |
| WS-13 CWOS governance, agents, registry, work orders | Coordinator | D-026, D-034, D-136, D-144, D-152; #1857, #1861, #1961, #2059 | Deployed (migrations applied through 20261104240000) (In progress); 555 (435 merged PR, 79 closed issue, 30 open, 11 closed unmerged) | 29 open items. Supabase: 11 blocked, 1 executing, 1 no_execution_path, 5 verification pending outcomes. 63 work_register rows: 30 active, 1 blocked, 32 complete. Gap: closure rule and outcome evaluator (#1961) open. |
| WS-14 Batch Release, CAPA, 503B decision tools | Product | D-050, D-082; $75 Record experiment (#1284); Decision Tools PRs | Deployed (merged to main) (Completed (not verified)); 109 (104 merged PR, 3 closed issue, 1 open, 1 closed unmerged) | Product pages and tools. 1 open PR (see item map). No purchase or usage read in this audit. Gap: no outcome evidence. |
| WS-15 Assistant, intake, support, partner programs | Product | PRs #1322, #1529, #1538, #2121, #2130, #936 | Deployed (merged to main) (Completed (not verified)); 102 (87 merged PR, 10 closed issue, 0 open, 5 closed unmerged) | Visitor assistant, intake forms, support and partner pages. Gap: no inquiry-to-revenue evidence. |
| WS-16 Collectors, attribution, analytics, other product changes | Measurement | FDA/hiring collectors (#1415, #1419, #1377), attribution (#522), GA4 (#437), #670 open | Deployed (merged to main) (Completed (not verified)); 97 (83 merged PR, 12 closed issue, 1 open, 1 closed unmerged) | Broad rule: this row is a lower-confidence grouping of collector, attribution and miscellaneous product PRs. #670 (Consolidate The Inspection Record) open, no activity 54 days. Gap: collector output not read. |
| WS-99 Unmapped (reviewed) | Coordinator | n/a | n/a (Noise); 45 (32 merged PR, 12 closed issue, 0 open, 1 closed unmerged) | 45 items reviewed by title: miscellaneous fixes, two accidental issues (#407, #610), one-off page tweaks. Not workstream-grade; listed in the item map. |

## Five unrecorded assignments

| Assignment | Result | Evidence |
|---|---|---|
| Commercial Improvement Program | **Not found** | Zero hits for the phrase in astro/platform/case-files code, issue titles and bodies, PR titles and bodies. One code hit for "commercial improvement" (lowercase, different meaning): `docs/experiments/dda-entry-clarity-2026-09-30.md`. Nearest governed work: #2334 / D-202 (eight-week commercial operating program). |
| Eight-week Learning Series | **Found** | D-193 (`DECISION_LOG.md` line 2347); astro #2294, #2295, #2296, #2298 (closed); work register fba2a30c and five sibling Coordinator rows (active). Related: #2334 / D-202. |
| Portfolio sales activation | **Not found** (exact name) | Zero hits for the phrase. Nearest: D-139 bounded acquisition portfolio, #1970 (open), #1971 (closed), register `docs/commercial-experiments/2026-10-25-bounded-acquisition-portfolio.md`. Not the same assignment unless the founder confirms. |
| SEO improvements | **Found** | #281, #730-#736 (closed), #1163 and #1302 (open), #1972 (open); 80 in-window items in WS-04. |
| Content Studio commercialization | **Found** | #2151 (open), #1714, #1716, #1720-#1727; work register a8e31c3b (Marketing, active). Approval-gated pilot. |

## Known conflicts

| # | Item | Current state |
|---|---|---|
| 1 | Terminal-Proof Stage 3 references DDA/IRR conversion | **Confirmed.** `cw_capability_verification_queue` VP-03-CONVERSION, stage "DDA and IRR conversion/follow-up", pass condition requires a path "through DDA completion and IRR checkout initiation". Status DEFERRED, decision PENDING. D-056 (2026-10-08) retired DDA as front door. Not updated. |
| 2 | Candidate Acquisition OS (#339) and MailerLite specs assume Attio | **#339 does not match.** astro #339 is "CWOS autonomous execution acceptance test — controlled recovery proof" (closed 2026-08-24). No issue, PR or doc titled "Candidate Acquisition OS" exists. No MailerLite spec document found; MailerLite appears in `DECISION_LOG.md` (line 181, environment ladder) and a Supabase function `format_lead_for_mailerlite` flagged in `EXECUTION_QUEUE.md`. Legacy `docs/attio-*.md` (8 files) remain in astro. |
| 3 | DDA freeze and IRR-direct routing deployed | **Decision and code on `main`, deployed at `5cafcf1`.** D-056, D-057, D-058, D-079, D-081 record the freeze and IRR-direct routing; REC-006 (Attio removed from commercial path, sender-v74) is marked complete in the work register. Not walked end to end in production in this audit. |
| 4 | $149 Case File credit against $497 IRR | **Implemented in code.** `src/lib/case-file-credit-cta.ts` (CTA with `cf_credit` Stripe session reference; irr-checkout converts it to a single-use coupon per its header comment). case-files prod deploy 2026-10-08 ships the CTA (#31). Redemption never exercised: no non-test Case File purchase or IRR order. Open conflict #1824: Terms/pricing say 30 days, delivery email and clock say 48 hours. |
| 5 | IRR milestones 7, 7A, 8; #1778 (E1, E0b) | **M7A:** "Complete" per `docs/CW-MDR-008-milestone-8-execution-optimization.md` header; no M7A close record located elsewhere. **M7:** no specification or close record located. **M8:** spec committed; closure requires the IRR commercialization quality gate; step PR #88 closed 2026-08-13; no close record. **#1778 (E1):** closed 2026-10-22, implemented by PR #1780 (merged 2026-10-22), no runtime change. **E0b:** addendum PR #1779 open since 2026-10-22 (docs only); related fixes #1808, #1809, #1814, #1815 merged 2026-10-22 (#1815 source only, not deployed). E2 #1781, E3 #1785, E4 #1798, review #1796, E5-E7 #1804 open; #1828 blocks E6/E7. E5 blocked on Owner decisions per #1779. |

## Blocked work and blocker

| Item | Blocker |
|---|---|
| VP-01-CANDIDATE (capability queue) | Repair deployed after last failed business-day run; waiting on next scheduler-originated run. Deadline 2026-09-01 passed. |
| VP-04-PAYMENT | FAILED: verification SLA expired 2026-08-30 without terminal proof; decision REPAIR. |
| Work register 8f494279 (Product, IRR friction) | Guardrail `cw_commercial_guardrail_state.journey_identity_status` not satisfied. |
| Work register 424cfa14 (Coordinator) | No registered executor (`no_execution_path`). |
| Growth LinkedIn outcomes 831a5058, 22ddbbec, c2b5bd70 | `unresolved_ambiguous_provider_outcome` (dispatch). Issues #2270, #2311, #2338 open (same title, recurring). |
| Growth outcome 7e6c6544 | `route_worker_check_failed`. |
| Growth outcome 63a83623 | Held by executor 2026-10-30: draft misdescribes Issue 03. |
| Outcomes b6b0eaf5 (Search authority), 3ea72c72 (Product, sample view repair) | `verification_overdue`. |
| Outcome 0100b7db (Revenue, consented inquiry) | Escalated: inquiry_followup. |
| #1828 | Protected Supabase workflow access not granted to Operations (E6/E7). |
| Outcomes fe74112d, 1c3621ca, 2c170a8c | Lifecycle acceptance-test fixtures (test rows left blocked); classify as test noise. |

## Abandoned (open, no activity 30+ days, no closing record)

astro #595 (38 d), #631 (57), #642 (57), #670 (54), #689 (51), #690 (52), #726 (49), #1056 (35), #1163 (32), #1165 (32), PR #1225 (30); platform #7 (73); case-files #13 (79), #14 (79), PR #17 (58).

## Duplicates

- case-files #13 / #14: same title, same date.
- astro #2270 / #2311 / #2338: identical auto-recovery title (dispatch lifecycle blocked); PRs #2271, #2313, #2339 each titled "Codex execution".
- astro #1639 / #1643 / #1654 and #1641 / #1644: article issue and its PRs.
- astro #1668 / #1670 / #1684: strategic signal issue with two PRs.
- astro #1849 / #2201: same Product E6/E7 secrets-workflow work.

## Exceptions needing founder decision

1. **Commercial Improvement Program** is in no record. Confirm whether it is a real assignment (and its owner) or retire it.
2. **Portfolio sales activation:** confirm it equals D-139 bounded acquisition portfolio (#1970) or is separate.
3. **Baseline register:** `.docx` was not uploaded to any reachable location. Re-upload to reconcile row-by-row.
4. **`cw-authorization-record`** repo is not reachable by this session. Grant access if its issues and PRs belong in scope.
5. **#1824:** 30-day (Terms) versus 48-hour (delivery email, clock) credit window is a customer commitment. Needs a ruling.
6. **#1779 / E5:** blocked on Owner decisions listed in addendum section 9.
7. **VP-03-CONVERSION** still defines Terminal-Proof Stage 3 as DDA to IRR; confirm the IRR-direct redefinition before the queue is re-baselined.
8. **Stale open items** in the Abandoned list: close, re-own or revive. This audit closed nothing.

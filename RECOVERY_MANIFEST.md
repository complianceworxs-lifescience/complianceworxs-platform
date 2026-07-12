# PF-1A Recovery Manifest — complianceworxs-platform

Tracks recovery of every deployed Supabase Edge Function (project `balkvbmtummehgbbeqap`)
plus the contract compiler into version control. Recovery only — no refactoring
until PF-1A closes (see README.md).

## Phase 1 — IRR Critical Path

| Component | Status | Verified Against Production | Commit |
|---|---|---|---|
| contract.yaml | Pending | — | — |
| compile.js | Pending | — | — |
| irr-stage-engine | Pending | — | — |
| irr-job-worker | Complete | Yes | 78f0a59aa7f671d87eaf5fc4fbdb4e2d350a090f |
| irr-generate | Complete | Yes | ee418ff245515d370ffa0542ff26bd23e8763768 |
| irr-unlock | Complete | Yes | 1e945470b54aa3b547b1af78ae6b26c8569f71d2 |
| irr-checkout | Complete | Yes | 27172c8acca665253fdebda32e60736cf8997f34 |
| irr-stripe-webhook | Complete | Yes | f9519cecdbcc4df1b24a32dcb7b674c1a91253c4 |
| irr-access-request | Complete | Yes | 1f09592b636a390a214e4ec7ec32dda82a79f057 |
| validate-editorial-contract | Pending | — | — |
| compile-editorial-contract | Pending | — | — |
| compile-prompt-specification | Pending | — | — |
| validate-editorial-output | Pending | — | — |
| irr-regression-test | Pending | — | — |
| generate-irr | Pending | — | — |
| generate | Pending | — | — |
| generate-batch-review | Pending | — | — |
| generate-executive-brief | Pending | — | — |
| job-status | Pending | — | — |
| irr-stage7-diag | Pending | — | — |
| irr-stage7-batch-diag | Pending | — | — |
| irr-remediation-diag | Pending | — | — |
| runtime | Pending | — | — |
| runtime-worker | Pending | — | — |

## Phase 2 — Product / Delivery Functions

| Component | Status | Verified Against Production | Commit |
|---|---|---|---|
| defense-pack-generate | Pending | — | — |
| defense-pack-stripe-webhook | Pending | — | — |
| case-file-render | Pending | — | — |
| case-file-checkout | Pending | — | — |
| case-file-pdf-upload | Pending | — | — |
| ddr-gate-capture | Pending | — | — |
| ddr-verify-token | Pending | — | — |
| ddr-grant-access | Pending | — | — |
| purchase-fulfillment-send | Pending | — | — |
| stripe-webhook | Pending | — | — |
| stripe-setup | Pending | — | — |
| stripe-worker | Pending | — | — |
| checkout-session-handler | Pending | — | — |
| stripe-orders-reconcile | Pending | — | — |
| stripe-price-audit | Pending | — | — |
| page-price-audit | Pending | — | — |
| irr-v2-oneshot | Pending | — | — |
| irr-vi-oneshot | Pending | — | — |

## Phase 3 — Outbound / Ops Automation

| Component | Status | Verified Against Production | Commit |
|---|---|---|---|
| assessment-lead | Pending | — | — |
| capture-lead | Pending | — | — |
| capture-identity | Pending | — | — |
| attio-sync | Pending | — | — |
| attio-approval-webhook | Pending | — | — |
| staging-to-attio | Pending | — | — |
| attribute-partner | Pending | — | — |
| lead-outreach-email | Pending | — | — |
| lead-fit-scorer | Pending | — | — |
| outbound-sender-gmail | Pending | — | — |
| outbound-optimizer | Pending | — | — |
| outbound-ml-analyzer | Pending | — | — |
| outbound-health-audit | Pending | — | — |
| gmail-reply-handler | Pending | — | — |
| gmail-reply-poller | Pending | — | — |
| gmail-auth-diag | Pending | — | — |
| gmail-oauth-probe | Pending | — | — |
| gmail-linkedin-acceptance-watcher | Pending | — | — |
| gmail-linkedin-debug | Pending | — | — |
| linkedin-acceptance-handler | Pending | — | — |
| email-verifier | Pending | — | — |
| prospeo-linkedin-enrich | Pending | — | — |
| company-research-anthropic | Pending | — | — |
| daily-brief-generator | Pending | — | — |
| daily-brief-oneshot | Pending | — | — |
| daily-autopilot | Pending | — | — |
| followup-drafter | Pending | — | — |
| followup-drafter-test | Pending | — | — |
| followup-dispatcher | Pending | — | — |
| first-touch-drafter | Pending | — | — |
| dm-dispatcher | Pending | — | — |
| dm-log-manual | Pending | — | — |
| force-send-caroline | Pending | — | — |
| pipeline-watchdog | Pending | — | — |
| job-scraper | Pending | — | — |
| posthog-webhook | Pending | — | — |
| posthog-webhook-setup | Pending | — | — |
| posthog-conversion-monitor | Pending | — | — |
| resource-download-send | Pending | — | — |
| partner-report | Pending | — | — |
| partner-application-notifier | Pending | — | — |
| partner-connect-onboard | Pending | — | — |
| partner-connect-webhook | Pending | — | — |
| partner-reporter | Pending | — | — |
| tir-digest-subscribe | Pending | — | — |
| campaign-plan | Pending | — | — |
| conversion-playbook | Pending | — | — |
| nurture-link-click-handler | Pending | — | — |
| reconstruction-funnel-probe | Pending | — | — |
| reconstruction-dropoff-probe | Pending | — | — |
| reconstruction-conversion-monitor | Pending | — | — |
| exit-overlay-probe | Pending | — | — |
| inspection-exposure-submit | Pending | — | — |
| gemini-key-probe | Pending | — | — |

## Summary

Total tracked: 91 (2 compiler assets + 89 edge functions)
Complete: 6

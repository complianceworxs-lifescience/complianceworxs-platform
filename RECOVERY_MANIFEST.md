# PF-1A Recovery Manifest — complianceworxs-platform

Tracks recovery of every deployed Supabase Edge Function (project `balkvbmtummehgbbeqap`)
plus the contract compiler into version control. Recovery only — no refactoring
until PF-1A closes (see README.md).

## Phase 1 — IRR Critical Path

| Component | Status | Verified Against Production | Commit |
|---|---|---|---|
| contract.yaml | Pending | — | — |
| compile.js | Pending | — | — |
| irr-stage-engine | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| irr-job-worker | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| irr-generate | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| irr-unlock | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| irr-checkout | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| irr-stripe-webhook | Complete | Yes | f9519cecdbcc4df1b24a32dcb7b674c1a91253c4 |
| irr-access-request | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| validate-editorial-contract | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| compile-editorial-contract | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| compile-prompt-specification | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| validate-editorial-output | Complete | Yes | bfdb3aad992f638ab35209a554d1da9faf29dc44 |
| irr-regression-test | Complete | Yes | 11a41b11bcb2adcfb482bf97ee928b47157ae586 |
| generate-irr | Complete | Yes | 5dbf29ca80f7eb4d889e2512b52be5b0f8c134ed |
| generate | Complete | Yes | 1dca387a715a9fd72c22d76b4faff24afd3593c9 |
| generate-batch-review | Complete | Yes | 165bd171c09a5eb6097e081299c546f2f195b75f |
| generate-executive-brief | Complete | Yes | ad8bc4de335ee11a62dab9f3779f460bebeffdec |
| job-status | Complete | Yes | 62d87a85d06175d4198fc952f882ec17620fb9ba |
| irr-stage7-diag | Complete | Yes | 10b22ba565cbce45d986388be48627cfc412393a |
| irr-stage7-batch-diag | Complete | Yes | 98c71b3bf7dfd2ed22b5bec4ac03c59512f78aec |
| irr-remediation-diag | Complete | Yes | 46a2e51e78923ebe369bae61d49f68d21ca5fa94 |
| runtime | Complete | Yes | 21df3565dbddc67cf9b85cd652db53ccf54c35a8 |
| runtime-worker | Complete | Yes | 0792da5eaa47ca7a1804d024d245451877f78b1e |

## Phase 2 — Product / Delivery Functions

| Component | Status | Verified Against Production | Commit |
|---|---|---|---|
| defense-pack-generate | Complete | Yes | 0bc915afdf5f0028126a92b07c93ccbaae0aeff3 |
| defense-pack-stripe-webhook | Complete | Yes | b533853a5ed752ac527fc632dfc5aa21adcef829 |
| case-file-render | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| case-file-checkout | Complete | Yes | a4ba13cd4ce3945999f1f3e101b3c4a47535c197 |
| case-file-pdf-upload | Complete | Yes | 575c8e4e0ded2c3f6f9142eea2bfec19ce79997d |
| ddr-gate-capture | Complete | Yes | de894b057b16f2eafe403edd22bd105deb91097f |
| ddr-verify-token | Complete | Yes | fb35ccb22c95b9743b59ad0f1f1e85b4a462b90c |
| ddr-grant-access | Complete | Yes | 9380434598935d04ff79235d4ec9792f4124ca76 |
| purchase-fulfillment-send | Complete | Yes | 7a3c2428dfd21f35eab42b8e45a5034f1bf12872 |
| stripe-webhook | Complete | Yes | 68f18a2ede33d31c95a9fa1d9c8d82e07a3a0f71 |
| stripe-setup | Complete | Yes | f249d0abff0c14d8813f330c1410887820311343 |
| stripe-worker | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| checkout-session-handler | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| stripe-orders-reconcile | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| stripe-price-audit | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| page-price-audit | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| irr-v2-oneshot | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| irr-vi-oneshot | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |

## Phase 3 — Outbound / Ops Automation

| Component | Status | Verified Against Production | Commit |
|---|---|---|---|
| assessment-lead | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| capture-lead | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| capture-identity | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| attio-sync | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| attio-approval-webhook | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| staging-to-attio | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| attribute-partner | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| lead-outreach-email | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| lead-fit-scorer | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| outbound-sender-gmail | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| outbound-optimizer | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| outbound-ml-analyzer | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| outbound-health-audit | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| gmail-reply-handler | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| gmail-reply-poller | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| gmail-auth-diag | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| gmail-oauth-probe | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| gmail-linkedin-acceptance-watcher | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| gmail-linkedin-debug | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| linkedin-acceptance-handler | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| email-verifier | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| prospeo-linkedin-enrich | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| company-research-anthropic | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| daily-brief-generator | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| daily-brief-oneshot | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| daily-autopilot | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| followup-drafter | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| followup-drafter-test | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| followup-dispatcher | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| first-touch-drafter | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| dm-dispatcher | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| dm-log-manual | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| force-send-caroline | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| pipeline-watchdog | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| job-scraper | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| posthog-webhook | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| posthog-webhook-setup | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| posthog-conversion-monitor | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| resource-download-send | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| partner-report | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| partner-application-notifier | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| partner-connect-onboard | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| partner-connect-webhook | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| partner-reporter | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| tir-digest-subscribe | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| campaign-plan | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| conversion-playbook | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| nurture-link-click-handler | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| reconstruction-funnel-probe | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| reconstruction-dropoff-probe | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| reconstruction-conversion-monitor | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| exit-overlay-probe | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| inspection-exposure-submit | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |
| gemini-key-probe | Complete | Yes | fcf6cde7d73fefa1ba23d2203f7e636e29200615 |

## Summary

Total tracked: 96 (2 compiler assets + 94 edge functions)
Complete: 94 (all 94 edge functions; 2 compiler assets still Pending)
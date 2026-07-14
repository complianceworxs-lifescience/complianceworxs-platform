# PF-1B Migration↔Live Drift Report (metadata reconciliation)

Method: parsed all 330 `supabase/migrations/*.sql` for declared objects and compared
against the live schema snapshot. Extension-owned objects (via `pg_depend`) were
excluded as noise (e.g. 118 pgvector functions in `public`). No Supabase branch /
replay was used. Regex DDL parse is best-effort; "unaccounted" = the object's name
does not appear in **any** migration text.

**Result: the migration history does NOT fully reproduce production.** 29 app-level
objects exist in the live database but are created by no migration — i.e. they were
applied out-of-band (SQL editor / dashboard) and never captured as migrations.

## Out-of-band objects (exist live, no migration creates them)

### Tables (3) — plus their RLS enablement and policy
- `batch_review_feedback` (has policy **"anon insert only"**, RLS enabled out-of-band)
- `free_reviews`
- `irr_siblings`

### Views (1)
- `v_revenue_daily`

### Triggers (2) — PostHog purchase eventing cluster
- `trg_posthog_purchase_on_insert`
- `trg_posthog_purchase_on_status_change`

### Functions (12, app-owned, non-extension)
- `fire_posthog_purchase_event` (pairs with the two triggers above)
- `get_revenue_status`, `get_operating_dashboard`, `refresh_key_results` (revenue/reporting)
- `generate_partner_code`, `on_partner_application_approved` (partner)
- `check_auth_status`, `detect_strategy_signals`, `dm_send_eligibility`,
  `exec_optimization_query`, `protect_cohort_leads_from_disqualification`, `rls_auto_enable`

### pg_cron jobs (10)
- `conversion-playbook-daily-8am-edt`, `posthog-conversion-monitor-daily-515am-edt`,
  `page-price-audit-daily-505am-edt`, `gmail-linkedin-acceptance-watcher-15min`,
  `gmail-reply-poller-5min`, `stripe-orders-reconcile`, `stripe-sync-worker`,
  `partner-conversion-alerts`, `partner-weekly-digest`, `partner-monthly-statement`

## Separate note — extensions enabled outside migrations (6, not app drift)
`btree_gist`, `pg_stat_statements`, `pgmq`, `supabase_vault`, `uuid-ossp`, `wrappers`
were enabled via the Supabase dashboard/defaults, not `CREATE EXTENSION` in a migration.
Platform-managed; recorded for completeness, not counted as app drift.

## What this check CANNOT resolve (would need the replay-diff)
Object-existence drift is fully found above and each object's live definition is
already captured in `schema-snapshot/`. But two drift classes are invisible to a
name-level metadata check and require a replay-diff (or a definition-level diff):

1. **Attribute drift on migration-tracked tables** — a column type / default /
   nullability / constraint changed by a manual `ALTER` after its migration. The table
   is "accounted for" by name, so this check can't see it.
2. **Body drift on migration-tracked functions/views/triggers** — an object whose
   name IS in a migration but was later `CREATE OR REPLACE`'d manually with a different
   body. Name matches → counted as accounted-for, but the live body may differ from
   what the last migration declared.

Resolving 1 and 2 needs either a scratch-DB replay + schema diff, or a definition-level
comparison of the live snapshot against the migration-declared DDL. Deferred to an
explicit decision (per instruction, no branch provisioned).

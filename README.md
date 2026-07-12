# ComplianceWorxs Platform

Execution engine, contract compiler, and verification tooling for ComplianceWorxs — the source of truth for what runs in production.

## Status: PF-1A Recovery In Progress

This repository is being populated via Platform Foundation 1A (PF-1A): recovering
every deployed Supabase Edge Function, the contract compiler, and verification
tooling into version control for the first time.

See `RECOVERY_MANIFEST.md` for live recovery status.

## Structure

- `/edge-functions` — recovered Supabase Edge Function source, one folder per function
- `/contracts` — contract.yaml and generated contract artifacts
- `/compiler` — the contract compiler (compile.js)
- `/verification` — Milestone 7 verification tooling
- `/supabase` — schema, migrations, RLS policies (PF-1B)
- `/tests` — regression corpus and stage certification
- `/docs` — architecture and governance documents (CW-ARCH-001, CW-EXEC-001, CW-GOV-001)

## Recovery discipline

PF-1A is recovery, not refactoring. Recovered source must match production
byte-for-byte (or functionally, where noted). No cleanup or deduplication
happens until PF-1A closes and Platform Modernization begins as its own
tracked effort.

# CW-GEMINI-OPERATOR-BRIDGE-001

Status: Implementation draft
Owner: ComplianceWorxs operating system
Purpose: Remove the founder from routine Gemini <-> cross-system operator handoffs.

## Business rule

The bridge exists to reduce founder attention. It MUST NOT create a second CRM, invent CW doctrine, or escalate routine execution to the founder.

Gemini remains the Google-native intelligence layer. Attio remains commercial truth. The external operator performs authorized cross-system work. The execution ledger provides evidence and provenance.

## Flow

1. Gemini/Workspace creates a structured handoff only when external execution is required.
2. The bridge validates the handoff and assigns an idempotency/correlation key.
3. The bridge invokes the external operator.
4. The operator executes only within the requested authority boundary.
5. Completion, failure, or escalation is written back as structured evidence.
6. Gemini consumes the result in subsequent Workspace reasoning and the Executive Intelligence Brief.
7. Jon is involved only when the founder-escalation rule is satisfied.

## Handoff contract v1

```json
{
  "schema_version": "1.0",
  "handoff_id": "uuid",
  "created_at": "ISO-8601",
  "source": "gemini_workspace",
  "action_type": "ATTIO_UPDATE|GITHUB_ACTION|VERCEL_ACTION|CROSS_SYSTEM_RESEARCH|OTHER",
  "business_reason": "Why this action matters to CW",
  "requested_action": "Concise imperative instruction",
  "target": {
    "system": "attio|github|vercel|other",
    "record_id": "optional stable identifier"
  },
  "evidence_refs": ["Drive/Sheet/record references"],
  "commercial_relevance": "high|medium|low|none",
  "founder_escalation": false,
  "authority": "execute|draft_only|analyze_only",
  "correlation_id": "stable-idempotency-key"
}
```

## Result contract v1

```json
{
  "schema_version": "1.0",
  "handoff_id": "uuid",
  "correlation_id": "stable-idempotency-key",
  "status": "completed|blocked|failed|escalated|suppressed",
  "operator": "chatgpt_operator",
  "action_executed": "What actually happened",
  "target_artifact": "record/file/PR/etc",
  "evidence_refs": ["verifiable result references"],
  "business_outcome": "What changed for CW",
  "founder_escalation": false,
  "error": null,
  "completed_at": "ISO-8601"
}
```

## Safety and control rules

- No free-form agent-to-agent conversation is required. Handoffs are structured state transitions.
- Every request and result must carry `handoff_id` and `correlation_id`.
- Duplicate correlation IDs must not execute twice.
- `BASELINE_SEED` is initialization evidence and never a material commercial event.
- Background scans and health checks do not count as AI Business Actions Completed.
- If evidence is insufficient, return `blocked`; do not infer missing business facts.
- If an action exceeds delegated authority, return `escalated`; do not execute it.
- Founder escalation is an exception path, not the default path.
- Secrets must never be stored in the handoff payload, repository, Sheet, or execution ledger.

## Initial transport

Use the existing ComplianceWorxs platform execution infrastructure as the durable transport rather than introducing another middleware product. The current platform already contains Supabase execution jobs/events and work-item consumer/callback patterns. The bridge should reuse those primitives where practical and add a dedicated Gemini/operator adapter rather than coupling Gemini directly to Attio or GitHub.

## Phase 1 acceptance test

A synthetic, non-customer-facing Gemini handoff must:

1. enter the bridge;
2. be validated;
3. create exactly one operator job;
4. produce a structured result;
5. record evidence;
6. be visible to Gemini without manual copy/paste;
7. require no founder action;
8. prove idempotency by rejecting/suppressing a duplicate correlation ID.

Production business actions remain disabled until this test passes.

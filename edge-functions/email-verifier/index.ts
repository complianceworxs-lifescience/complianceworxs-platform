// email-verifier v5 — May 15 2026 — DEPRECATED 410 STUB
//
// Reason for deprecation:
//   Hunter account closed (May 15 2026). Prospeo deprecated their standalone
//   /email-verifier endpoint on March 1 2026 (no replacement endpoint).
//   Verification is now done inline by prospeo-linkedin-enrich, which only
//   returns emails with status='VERIFIED'. Standalone verification of
//   pattern-guessed emails is no longer supported by the CW stack.
//
//   If a future need arises (e.g. inbound form email validation), pick a real
//   provider (Kickbox, ZeroBounce, MillionVerifier) and replace this stub.
//
// Returns 410 Gone for all requests so callers fail loud instead of silent.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "deprecated",
      message: "email-verifier is deprecated. Hunter account closed; Prospeo standalone verifier removed Mar 1 2026. Verification is now inline via prospeo-linkedin-enrich (only returns VERIFIED emails).",
      deprecated_at: "2026-05-15",
      replacement: "prospeo-linkedin-enrich",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  );
});

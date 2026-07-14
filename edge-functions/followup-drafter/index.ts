// followup-drafter v9 — May 18 2026 — BRAND REGEX URL FIX
//
// V8 → V9 CHANGES:
//   1. Brand-mention validator strips URLs before checking. The case file URL
//      contains "complianceworxs.com" which legitimately appears on touch 3 —
//      v8 caught it as a brand violation. Fix: check only the prose, not URLs.
//   2. Hallucination regex tightened: "the link I sent" was overlapping with
//      "the link" in touch 3 prose around the URL. Made hallucination check
//      also skip URLs.
//
// V7 → V8 (preserved):
//   1. Model: gemini-2.5-flash via responseSchema.
//   2. Single-call write (no research step for followups).
//   3. Preserved validator + retry-with-feedback architecture.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MAX_PER_RUN = 25;
const MAX_WORDS_TOUCH_1_2 = 85;
const MAX_WORDS_TOUCH_3 = 95;
const GEMINI_WRITE_MODEL = 'gemini-2.5-flash';
const WRITE_TIMEOUT_MS = 15000;
const BATCH_STAGGER_MS = 400;

function caseFileUrl(interest: string | null): string {
  if (!interest) return 'https://cases.complianceworxs.com';
  const k = interest.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const map: Record<string,string> = {
    'process-validation': 'https://cases.complianceworxs.com/process-validation',
    'batch-release': 'https://cases.complianceworxs.com/batch-release-authorization',
    'batch-release-authorization': 'https://cases.complianceworxs.com/batch-release-authorization',
    'oos-investigation': 'https://cases.complianceworxs.com/oos-investigation',
    'oos': 'https://cases.complianceworxs.com/oos-investigation',
    'deviation-root-cause': 'https://cases.complianceworxs.com/deviation-root-cause',
    'deviation': 'https://cases.complianceworxs.com/deviation-root-cause',
    'deviation-risk-authorization': 'https://cases.complianceworxs.com/deviation-root-cause',
    'change-control': 'https://cases.complianceworxs.com/change-control',
    'change-control-risk': 'https://cases.complianceworxs.com/change-control',
    'capa-effectiveness': 'https://cw-inspection-case-files.vercel.app/capa-effectiveness',
    'capa-closure': 'https://cw-inspection-case-files.vercel.app/capa-effectiveness',
    'data-integrity': 'https://cases.complianceworxs.com/data-integrity',
    'supplier-qualification': 'https://cases.complianceworxs.com/supplier-qualification',
    'stability-oot': 'https://cases.complianceworxs.com/stability-oot',
    'complaint-investigation': 'https://cases.complianceworxs.com/complaint-investigation',
  };
  return map[k] || 'https://cases.complianceworxs.com';
}

function stageToTouchNumber(stage: string | null): number {
  if (!stage) return 1;
  const m = stage.match(/followup_(\d+)_due/);
  return m ? parseInt(m[1], 10) : 1;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// v9: strip URLs before content-prose validation so the case file URL doesn't
// trigger the brand regex.
function stripUrls(s: string): string {
  return s.replace(/https?:\/\/\S+/gi, '').replace(/\s{2,}/g, ' ');
}

function validateBody(body: string, touchNumber: number): string[] {
  const violations: string[] = [];
  const wc = wordCount(body);
  const maxWords = touchNumber === 3 ? MAX_WORDS_TOUCH_3 : MAX_WORDS_TOUCH_1_2;

  if (wc > maxWords) {
    violations.push(`word count ${wc} exceeds max ${maxWords} for touch ${touchNumber} — tighten ruthlessly`);
  }

  // v9: brand check on prose only, not URLs
  const proseOnly = stripUrls(body);

  const brandRegex = /\b(complianceworxs|complianceworx|\bCW\b|\bIRR\b|\bDDR\b|Inspection Response Record|Decision Defense Record)\b/i;
  if (brandRegex.test(proseOnly)) {
    violations.push('mentions ComplianceWorxs, CW, IRR, or DDR by name in prose — strip all product/brand references');
  }

  const halluRegex = /(the PDF|as attached|attached PDF|I sent earlier|I mentioned|I shared|the document I sent|the file I sent|sent you a)/i;
  if (halluRegex.test(proseOnly)) {
    violations.push('references an artifact that does not exist in the prior thread — remove all references to PDFs, attachments, or things "I mentioned"');
  }

  // URL check uses original body (URLs are checked for presence, not stripped)
  const urlRegex = /https?:\/\//i;
  if (touchNumber !== 3 && urlRegex.test(body)) {
    violations.push(`touch ${touchNumber} must contain no URL — remove all links`);
  }

  const deadPhrasesRegex = /\b(following up|circling back|checking in|just wanted to|wanted to follow|reaching out again)\b/i;
  if (deadPhrasesRegex.test(proseOnly)) {
    violations.push('contains a dead phrase (following up / circling back / checking in / just wanted to) — rewrite the opening');
  }

  return violations;
}

function buildPrompt(
  angle: string,
  guidance: string,
  touchNumber: number,
  lead: any,
  firstTouchSubject: string | null,
  firstTouchBody: string | null,
  caseFileUrlForLead: string,
  retryFeedback: string | null = null,
): string {
  const role = lead.job_title || 'QA leader';
  const company = lead.company || 'their facility';
  const firstName = (lead.full_name || '').split(' ')[0] || '';
  const wordCap = touchNumber === 3 ? MAX_WORDS_TOUCH_3 : MAX_WORDS_TOUCH_1_2;
  const scenarioLabel = lead.case_file_interest || 'authorization records';

  const firstTouchContext = (firstTouchSubject || firstTouchBody)
    ? `\n\nORIGINAL FIRST EMAIL (thread continuity — do not repeat its content, do not reference an attached PDF — there was no attachment):\nSubject: ${firstTouchSubject || '(unknown)'}\nBody:\n${(firstTouchBody || '').slice(0, 600)}`
    : '';

  const urlContext = touchNumber === 3
    ? `\n\nCASE FILE URL TO INCLUDE (touch 3 only):\nScenario label: ${scenarioLabel}\nURL: ${caseFileUrlForLead}\n\nUse this URL verbatim, once, on its own line. Do not invent other links. Do not pitch payment. (The URL contains the word "complianceworxs" — that's fine in the URL, but do not use the word elsewhere in your prose.)`
    : `\n\nIMPORTANT: This touch must NOT contain any URL, link, or call-to-action to buy. No product pitch. No demo offer. No call request. The body is a peer-level reframe or evidence drop only.`;

  const retryBlock = retryFeedback
    ? `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Specific violations to fix:\n${retryFeedback}\n\nRewrite the body to fix every violation. Do not repeat the same content; tighten and restructure.`
    : '';

  return `You are drafting follow-up email #${touchNumber} for ComplianceWorxs cold outbound to QA, regulatory, and validation leaders in FDA-regulated life sciences.

CRITICAL RULES (violations are auto-rejected):
1. Inspector-frame voice. Lead with the inspection question or consequence, never the product.
2. NEVER mention ComplianceWorxs, CW, the IRR, the DDR, "Inspection Response Record", "Decision Defense Record", or any product name in PROSE. The body is a peer-level reframe — not a pitch. (Touch 3's URL may contain the word "complianceworxs" — that's allowed only inside the URL itself.)
3. Never say "following up" or "circling back" or "checking in" or "just wanted to" or "reaching out again." These are dead phrases that get the email deleted.
4. NEVER reference an artifact that does not exist in the prior thread: no "the PDF I mentioned," no "as attached," no "the document I sent." The first email had only words.
5. Word count: this touch must be UNDER ${wordCap} words. Count ruthlessly. Aim for ${wordCap - 10}.
6. Plain text. No HTML. No markdown. No emojis. No subject line in output — body only.
7. Sign off: just "Jon" — nothing more, no title, no company, no URL.
8. Touches 1 and 2 contain NO URL. Touch 3 contains exactly one URL — the case file URL provided.
9. Reference the prior thread implicitly. Do not re-introduce yourself.
10. Vocabulary to use: authorization record, inspector question, contemporaneous documentation, sterility assurance reasoning, release rationale, 483 observation, reconstruction risk. Vocabulary to avoid: platform, solution, leverage, synergize, AI-powered, software, demo, call, meeting.

ANGLE FOR THIS TOUCH (#${touchNumber}): ${angle}

SPECIFIC GUIDANCE FOR THIS TOUCH:
${guidance}

RECIPIENT:
- Name: ${lead.full_name}
- First name (use this in salutation): ${firstName}
- Title: ${role}
- Company: ${company}
- Fit score: ${lead.fit_score || 'unknown'}/100${firstTouchContext}${urlContext}${retryBlock}

Return JSON matching the schema. The 'body' field contains the entire email body — open with the first name, sign off as "Jon". No subject line in body.`;
}

async function callGemini(prompt: string): Promise<{ body: string; debug: any }> {
  const debug: any = { stage: 'gemini_write', model: GEMINI_WRITE_MODEL };
  const schema = {
    type: 'object',
    properties: {
      body: {
        type: 'string',
        description: 'The complete email body, opening with the first name and signing off as "Jon". Plain text, no markdown, under the word cap.',
      },
    },
    required: ['body'],
  };

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_WRITE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0.7,
            maxOutputTokens: 2500,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      },
    );
    debug.status = r.status;
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 400);
      debug.error = errText;
      throw new Error(`gemini_http_${r.status}: ${errText}`);
    }
    const body = await r.json();
    debug.finish_reason = body.candidates?.[0]?.finishReason;
    debug.usage = body.usageMetadata;

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      debug.empty_response = true;
      throw new Error('empty_gemini_response');
    }

    const parsed = JSON.parse(text);
    const emailBody = (parsed.body || '').trim();
    if (!emailBody) {
      debug.empty_body_field = true;
      throw new Error('empty_body_field');
    }
    return { body: emailBody, debug };
  } catch (e) {
    const err = e as Error;
    debug.exception = err.message;
    debug.exception_name = err.name;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      debug.timeout = true;
    }
    throw err;
  }
}

async function generateBodyWithValidation(
  lead: any,
  cadence: any,
  firstTouchSubject: string | null,
  firstTouchBody: string | null,
  caseFileUrlForLead: string,
): Promise<{ body: string; violations: string[]; attempts: number; debug: any }> {
  const touchNumber = cadence.touch_number;

  // Attempt 1
  const prompt1 = buildPrompt(
    cadence.angle, cadence.guidance, touchNumber, lead,
    firstTouchSubject, firstTouchBody, caseFileUrlForLead, null,
  );
  const r1 = await callGemini(prompt1);
  const violations1 = validateBody(r1.body, touchNumber);
  if (violations1.length === 0) {
    return { body: r1.body, violations: [], attempts: 1, debug: r1.debug };
  }

  const retryFeedback = violations1.map(v => `- ${v}`).join('\n');
  const prompt2 = buildPrompt(
    cadence.angle, cadence.guidance, touchNumber, lead,
    firstTouchSubject, firstTouchBody, caseFileUrlForLead, retryFeedback,
  );
  const r2 = await callGemini(prompt2);
  const violations2 = validateBody(r2.body, touchNumber);

  if (violations2.length === 0) {
    return { body: r2.body, violations: [], attempts: 2, debug: r2.debug };
  }
  if (violations2.length < violations1.length) {
    return { body: r2.body, violations: violations2, attempts: 2, debug: r2.debug };
  }
  return { body: r1.body, violations: violations1, attempts: 2, debug: r1.debug };
}

function buildSubject(firstTouchSubject: string | null, _touchNumber: number): string {
  const base = (firstTouchSubject || 'A question on inspection authorization').replace(/^Re:\s*/i, '');
  return `Re: ${base}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') === '1';
  const singleId = url.searchParams.get('id');
  const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = !isNaN(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_PER_RUN) : MAX_PER_RUN;

  const { data: cadenceRows, error: cadenceErr } = await supabase
    .from('outbound_followup_cadence')
    .select('touch_number, days_after_previous, angle, guidance, active')
    .eq('active', true);

  if (cadenceErr || !cadenceRows?.length) {
    return new Response(JSON.stringify({ error: 'cadence_load_failed', detail: cadenceErr?.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const cadenceMap = new Map<number, any>();
  cadenceRows.forEach(r => cadenceMap.set(r.touch_number, r));

  let leads: any[] = [];
  if (singleId) {
    const { data: one, error: oneErr } = await supabase
      .from('warm_outbound_staging')
      .select('id, full_name, email, job_title, company, fit_score, case_file_interest, first_touch_draft_subject, first_touch_draft_body, followup_drafts, followup_stage')
      .eq('id', parseInt(singleId, 10))
      .maybeSingle();
    if (oneErr || !one) {
      return new Response(JSON.stringify({ error: 'lead_not_found', detail: oneErr?.message }),
        { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    leads = [one];
  } else {
    const { data, error } = await supabase.rpc('fetch_followup_draft_candidates', { p_limit: limit });
    if (error) {
      return new Response(JSON.stringify({ error: 'fetch_failed', detail: error.message }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    leads = data || [];
  }

  if (!leads.length) {
    return new Response(JSON.stringify({
      ok: true,
      summary: 'No follow-ups due for drafting.',
      drafted: 0,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let drafted = 0, skipped = 0, failed = 0, validation_blocked = 0;
  const results: any[] = [];

  for (const lead of leads) {
    try {
      const touchNumber = singleId
        ? (parseInt(url.searchParams.get('touch') || '1', 10))
        : stageToTouchNumber(lead.followup_stage);
      const cadence = cadenceMap.get(touchNumber);

      if (!cadence) {
        skipped++;
        results.push({ id: lead.id, name: lead.full_name, status: 'skipped', reason: `no_cadence_for_touch_${touchNumber}` });
        continue;
      }

      if (dryRun) {
        const cfUrl = caseFileUrl(lead.case_file_interest);
        const start = Date.now();
        const { body, violations, attempts, debug } = await generateBodyWithValidation(
          lead, cadence, lead.first_touch_draft_subject, lead.first_touch_draft_body, cfUrl,
        );
        results.push({
          id: lead.id, name: lead.full_name, company: lead.company,
          status: 'dry_run',
          touch_number: touchNumber,
          angle: cadence.angle,
          attempts,
          word_count: wordCount(body),
          violations,
          body_full: body,
          ms: Date.now() - start,
          debug,
        });
        continue;
      }

      const cfUrl = caseFileUrl(lead.case_file_interest);
      const { body, violations, attempts } = await generateBodyWithValidation(
        lead, cadence, lead.first_touch_draft_subject, lead.first_touch_draft_body, cfUrl,
      );
      const subject = buildSubject(lead.first_touch_draft_subject, touchNumber);

      const existingDrafts = Array.isArray(lead.followup_drafts) ? lead.followup_drafts : [];
      const passedValidation = violations.length === 0;
      const newDraft = {
        touch_number: touchNumber,
        subject,
        body,
        angle: cadence.angle,
        drafted_at: new Date().toISOString(),
        sent_at: null,
        message_id: null,
        status: passedValidation ? 'drafted' : 'validation_failed',
        validation_violations: violations,
        attempts,
        validator_version: 'v9_gemini',
      };

      const updatedDrafts = [...existingDrafts, newDraft];

      const { error: updErr } = await supabase
        .from('warm_outbound_staging')
        .update({ followup_drafts: updatedDrafts })
        .eq('id', lead.id);

      if (updErr) {
        failed++;
        results.push({ id: lead.id, name: lead.full_name, status: 'update_failed', error: updErr.message });
        continue;
      }

      if (passedValidation) {
        drafted++;
        results.push({
          id: lead.id, name: lead.full_name, company: lead.company,
          touch_number: touchNumber, attempts,
          word_count: wordCount(body),
          body_preview: body.slice(0, 100),
          status: 'drafted',
        });
      } else {
        validation_blocked++;
        results.push({
          id: lead.id, name: lead.full_name, company: lead.company,
          touch_number: touchNumber, attempts,
          word_count: wordCount(body),
          violations,
          status: 'validation_failed_blocked_from_send',
        });
      }
      await new Promise(res => setTimeout(res, BATCH_STAGGER_MS));
    } catch (e) {
      failed++;
      results.push({ id: lead.id, name: lead.full_name, status: 'error', error: (e as Error).message.slice(0, 200) });
    }
  }

  return new Response(JSON.stringify({
    ok: failed === 0,
    summary: `Drafted ${drafted} (passed validation) | Validation-blocked ${validation_blocked} | Skipped ${skipped} | Failed ${failed} | Eligible ${leads.length}`,
    drafted, validation_blocked, skipped, failed, eligible: leads.length,
    model: GEMINI_WRITE_MODEL,
    results,
  }, null, 2), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});

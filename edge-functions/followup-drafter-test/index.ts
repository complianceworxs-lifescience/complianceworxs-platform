// followup-drafter-test v2 — with FORCE_RETRY mode
// Same as v1 but if ?force_fail=1, artificially lower the word limit to 30 to trigger retry path.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

function wordCount(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }

function validateBody(body: string, touchNumber: number, forcedMaxWords: number | null = null): string[] {
  const violations: string[] = [];
  const wc = wordCount(body);
  const maxWords = forcedMaxWords ?? (touchNumber === 3 ? 95 : 75);
  if (wc > maxWords) violations.push(`word count ${wc} exceeds max ${maxWords}`);
  if (/\b(complianceworxs|complianceworx|\bCW\b|\bIRR\b|\bDDR\b|Inspection Response Record|Decision Defense Record)\b/i.test(body))
    violations.push('brand mentioned');
  if (/(the PDF|as attached|attached PDF|I sent earlier|I mentioned|I shared|the document I sent|the file I sent|the link I sent|sent you a)/i.test(body))
    violations.push('hallucinated artifact');
  if (touchNumber !== 3 && /https?:\/\//i.test(body)) violations.push('URL on non-final touch');
  if (/\b(following up|circling back|checking in|just wanted to|wanted to follow|reaching out again)\b/i.test(body))
    violations.push('dead phrase');
  return violations;
}

function buildSystemPrompt(angle: string, guidance: string, touchNumber: number, retryFeedback: string | null = null, wordCap: number = 75): string {
  const retryBlock = retryFeedback
    ? `\n\nPREVIOUS ATTEMPT FAILED VALIDATION. Specific violations to fix:\n${retryFeedback}\n\nRewrite the body to fix every violation. Stay strictly under ${wordCap} words this time. Do not repeat the same content; tighten and restructure.`
    : '';
  return `You are drafting follow-up email #${touchNumber} for ComplianceWorxs cold outbound to QA, regulatory, and validation leaders in FDA-regulated life sciences.

CRITICAL RULES:
1. Inspector-frame voice.
2. NEVER mention ComplianceWorxs, CW, IRR, DDR.
3. Never say "following up" / "circling back" / "checking in."
4. NEVER reference an artifact not in the prior thread.
5. Word count: STRICTLY UNDER ${wordCap} words.
6. Plain text. No HTML. No markdown.
7. Sign off: just "Jon".
8. No URL on touches 1 and 2.
9. Reference the prior thread implicitly.
10. Use: authorization record, inspector question, contemporaneous documentation. Avoid: platform, solution, demo, call.

ANGLE: ${angle}

GUIDANCE:
${guidance}${retryBlock}

Return ONLY the email body.`;
}

async function callAnthropic(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 600,
      system: systemPrompt, messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`anthropic_error: ${data.error.message}`);
  return (data?.content?.[0]?.text || '').trim();
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get('id') || '', 10);
  const touchNumber = parseInt(url.searchParams.get('touch') || '1', 10);
  const forceFail = url.searchParams.get('force_fail') === '1';
  const forcedCap = forceFail ? 30 : null;
  if (!id) return new Response(JSON.stringify({ error: 'missing_id' }), { status: 400 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: lead } = await supabase.from('warm_outbound_staging')
    .select('id, full_name, email, job_title, company, industry, fit_score, first_touch_draft_subject, first_touch_draft_body, case_file_interest')
    .eq('id', id).maybeSingle();
  if (!lead) return new Response(JSON.stringify({ error: 'lead_not_found' }), { status: 404 });

  const { data: cadence } = await supabase.from('outbound_followup_cadence')
    .select('touch_number, angle, guidance').eq('touch_number', touchNumber).eq('active', true).maybeSingle();
  if (!cadence) return new Response(JSON.stringify({ error: 'cadence_not_found' }), { status: 404 });

  const firstName = (lead.full_name || '').split(' ')[0] || '';
  const wordCap = forcedCap ?? (touchNumber === 3 ? 95 : 75);
  const userMessage = `Draft follow-up #${touchNumber} for: ${lead.full_name}, ${lead.job_title}, ${lead.company}. Stay STRICTLY under ${wordCap} words. Open with first name. Sign off as "Jon". No URL. No brand mention.

ORIGINAL FIRST EMAIL (no PDF attached, no link to reference):
Subject: ${lead.first_touch_draft_subject}
Body:
${(lead.first_touch_draft_body || '').slice(0, 600)}`;

  const t1Start = Date.now();
  const prompt1 = buildSystemPrompt(cadence.angle, cadence.guidance, touchNumber, null, wordCap);
  const body1 = await callAnthropic(prompt1, userMessage);
  const violations1 = validateBody(body1, touchNumber, forcedCap);
  const t1Ms = Date.now() - t1Start;

  let body2: string | null = null;
  let violations2: string[] = [];
  let t2Ms = 0;

  if (violations1.length > 0) {
    const t2Start = Date.now();
    const prompt2 = buildSystemPrompt(cadence.angle, cadence.guidance, touchNumber, violations1.map(v => `- ${v}`).join('\n'), wordCap);
    body2 = await callAnthropic(prompt2, userMessage);
    violations2 = validateBody(body2, touchNumber, forcedCap);
    t2Ms = Date.now() - t2Start;
  }

  return new Response(JSON.stringify({
    lead: { id: lead.id, name: lead.full_name, company: lead.company },
    touch_number: touchNumber,
    forced_word_cap: forcedCap,
    attempt_1: { body: body1, word_count: wordCount(body1), violations: violations1, ms: t1Ms },
    retry_triggered: violations1.length > 0,
    attempt_2: body2 ? { body: body2, word_count: wordCount(body2), violations: violations2, ms: t2Ms } : null,
    retry_fixed_it: body2 !== null && violations2.length === 0,
    final_violations: body2 && violations2.length === 0 ? [] : (body2 && violations2.length < violations1.length ? violations2 : violations1),
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});

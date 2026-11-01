// LinkedIn post-level UTM standard.
//   utm_source   = linkedin
//   utm_medium   = organic_social
//   utm_campaign = <content_key>  (slug-YYYYMMDD, lowercase, hyphenated)
//   utm_content  = <buffer_post_id> (24 hex chars; unique per post)
// (utm_campaign, utm_content) is the exact join key used by cw-post-attribution-join.
// Mirrors the SQL functions cw_build_linkedin_utm_url / cw_validate_linkedin_utm_url.

export const UTM_SOURCE = 'linkedin';
export const UTM_MEDIUM = 'organic_social';
export const ALLOWED_HOSTS = ['www.complianceworxs.com', 'complianceworxs.com', 'cases.complianceworxs.com'];
const CAMPAIGN_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-(\d{4})(\d{2})(\d{2})$/;
const BUFFER_ID_RE = /^[a-f0-9]{24}$/;

export function slugify(input: string): string {
  return String(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** content_key = slug-YYYYMMDD (UTC date). */
export function contentKey(slug: string, date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) throw new Error('invalid date');
  const s = slugify(slug);
  if (!s) throw new Error('empty slug');
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `${s}-${ymd}`;
}

export function stripUtm(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  return u.toString();
}

export interface UtmInput { baseUrl: string; contentKey: string; bufferPostId: string }

/** Builds the tagged URL. Replaces any existing utm_* params; preserves all other params. Throws if inputs are invalid. */
export function buildTaggedUrl(i: UtmInput): string {
  const u = new URL(stripUtm(i.baseUrl));
  u.searchParams.set('utm_source', UTM_SOURCE);
  u.searchParams.set('utm_medium', UTM_MEDIUM);
  u.searchParams.set('utm_campaign', i.contentKey);
  u.searchParams.set('utm_content', i.bufferPostId);
  const out = u.toString();
  const v = validateTaggedUrl(out);
  if (!v.ok) throw new Error(`cannot build valid UTM url: ${v.errors.join('; ')}`);
  return out;
}

export interface UtmValidation {
  ok: boolean;
  errors: string[];
  utm?: { utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string };
}

export function validateTaggedUrl(url: string, expected?: { contentKey?: string; bufferPostId?: string }): UtmValidation {
  const errors: string[] = [];
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, errors: ['not a valid absolute URL'] }; }
  if (u.protocol !== 'https:') errors.push('must be https');
  if (/(^|\.)buff\.ly$/i.test(u.hostname)) errors.push('short links (buff.ly) are not allowed; they hide and rewrite UTMs');
  else if (!ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) errors.push(`host not allowed: ${u.hostname}`);
  const get = (k: string) => u.searchParams.getAll(k);
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    if (get(k).length === 0) errors.push(`missing ${k}`);
    else if (get(k).length > 1) errors.push(`duplicate ${k}`);
  }
  const extra = [...new Set([...u.searchParams.keys()].filter(k => k.toLowerCase().startsWith('utm_') &&
    !['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].includes(k)))];
  if (extra.length) errors.push(`unexpected params: ${extra.join(',')}`);
  const [src, med, camp, cont] = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].map(k => get(k)[0] ?? '');
  if (src && src !== UTM_SOURCE) errors.push(`utm_source must be ${UTM_SOURCE}`);
  if (med && med !== UTM_MEDIUM) errors.push(`utm_medium must be ${UTM_MEDIUM}`);
  if (camp) {
    const m = CAMPAIGN_RE.exec(camp);
    if (!m) errors.push('utm_campaign must be slug-YYYYMMDD (lowercase, hyphenated)');
    else {
      const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) errors.push('utm_campaign date is not a real date');
    }
  }
  if (cont && !BUFFER_ID_RE.test(cont)) errors.push('utm_content must be a 24-char lowercase hex buffer_post_id');
  if (expected?.contentKey && camp !== expected.contentKey) errors.push('utm_campaign does not match expected content_key');
  if (expected?.bufferPostId && cont !== expected.bufferPostId) errors.push('utm_content does not match expected buffer_post_id');
  return errors.length ? { ok: false, errors } : { ok: true, errors, utm: { utm_source: src, utm_medium: med, utm_campaign: camp, utm_content: cont } };
}

/** All http(s) URLs in free text (trailing punctuation trimmed). */
export function extractUrls(text: string): string[] {
  return (text.match(/https?:\/\/[^\s)>\]]+/g) ?? []).map(s => s.replace(/[.,;:!?]+$/, ''));
}

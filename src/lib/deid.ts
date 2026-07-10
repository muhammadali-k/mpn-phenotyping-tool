/*
 * Client-side de-identification helper (TypeScript port)
 * ------------------------------------------------------
 * Runs ENTIRELY in the browser. Best-effort scrubber for HIPAA "Safe Harbor"
 * identifier families. Ported from the reviewed deid.js: catches credentialed /
 * signature / all-caps / hyphenated names, textual & partial dates, ages >89,
 * dash-less SSNs, CSN/FIN/health-plan IDs, IPs, device serials, www URLs, and
 * city/state — while avoiding over-redaction of drug names, lab values and
 * genomic notation. Errs toward OVER-redaction (safe direction) over leaks.
 *
 * Pattern matching is assistive, NOT a guarantee — a plain name with no title
 * or label cannot be reliably matched. The user remains responsible.
 */

export interface DeidRule {
  id: string
  label: string
  re: RegExp
  replace: (...args: string[]) => string
}
export interface DeidFinding { label: string; count: number }
export interface DeidScan { findings: DeidFinding[]; total: number }

const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const STATE = '(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)'
const NAME = "[A-Z][A-Za-z'\\u2019-]*"
const R = (src: string, flags: string) => new RegExp(src, flags)

// ORDER MATTERS — URLs/IPs/labeled-IDs/names before generic date/zip rules.
export const RULES: DeidRule[] = [
  { id: 'email', label: 'Email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: () => '[EMAIL]' },
  { id: 'url', label: 'URL / web address', re: /\b(?:https?:\/\/|www\.)[^\s)>\]]+/gi, replace: () => '[URL]' },
  { id: 'ip', label: 'IP address', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, replace: () => '[IP]' },

  { id: 'ssn', label: 'SSN', re: /\b(?:SSN|Social\s+Security(?:\s*(?:No\.?|Number|#))?)\s*[:#]?\s*\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/gi, replace: () => 'SSN [REDACTED]' },
  { id: 'ssn_bare', label: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g, replace: () => '[SSN]' },
  { id: 'device', label: 'Device / serial #', re: /\b(?:serial(?:\s*(?:no\.?|number|#))?|S\/N|UDI|implant\s*ID|device\s*(?:ID|#))\s*[:#.]?\s*[A-Z0-9][A-Z0-9-]{4,}\b/gi, replace: () => '[DEVICE-ID]' },
  // connector optional; value must contain a digit so labels like "Order aspirin" aren't eaten
  { id: 'mrn', label: 'MRN / identifier #', re: /\b(?:MRN|CSN|FIN|Visit|Encounter|Enc|Order|Specimen|Accession|Acct|Account|Member(?:\s*ID)?|Subscriber|Policy|Beneficiary|Medicare|Medicaid|Insurance(?:\s*ID)?|Health\s*Plan|Authorization|Auth|Claim|Medical\s+Record)\s*(?:#|No\.?|Number|ID|:)?\s*[:#]?\s*(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{3,}\b/gi, replace: () => '[ID]' },

  { id: 'phone_intl', label: 'Phone / fax', re: /\+\d{1,3}[\s.-]?(?:\d{2,4}[\s.-]?){2,5}\b/g, replace: () => '[PHONE]' },
  { id: 'phone_struct', label: 'Phone / fax', re: /(?:\+?1[\s.-]?)?\(\d{3}\)\s*\d{3}[\s.-]?\d{4}\b|\b\d{3}[.-]\d{3}[.-]\d{4}\b/g, replace: () => '[PHONE]' },
  { id: 'phone_labeled', label: 'Phone / fax', re: /\b(?:phone|telephone|tel|fax|cell|mobile|pager|ph)\.?\s*[:#]?\s*(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/gi, replace: () => '[PHONE]' },

  { id: 'dob', label: 'Date of birth', re: /\b(?:DOB|D\.O\.B\.|Date of Birth|Birth ?date)\s*[:#]?\s*(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/gi, replace: () => 'DOB: [DATE]' },
  { id: 'date_numeric', label: 'Date', re: /\b(?:0?[1-9]|1[0-2])([\/.-])(?:0?[1-9]|[12]\d|3[01])\1\d{2,4}\b|\b(?:0?[1-9]|[12]\d|3[01])([\/.-])(?:0?[1-9]|1[0-2])\2\d{2,4}\b|\b(?:19|20)\d{2}([\/.-])(?:0?[1-9]|1[0-2])\3(?:0?[1-9]|[12]\d|3[01])\b/g, replace: () => '[DATE]' },
  { id: 'date_iso', label: 'Date', re: /\b(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\b/g, replace: () => '[DATE]' },
  { id: 'date_monthyear_text', label: 'Date', re: R('\\b' + MONTHS + '\\.?,?\\s+(?:19|20)\\d{2}\\b', 'gi'), replace: () => '[DATE]' },
  { id: 'date_dayfirst', label: 'Date', re: R('\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MONTHS + '\\.?(?:,?\\s+\\d{2,4})?\\b', 'gi'), replace: () => '[DATE]' },
  { id: 'date_monthfirst', label: 'Date', re: R('\\b' + MONTHS + '\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b', 'gi'), replace: () => '[DATE]' },
  { id: 'date_monthyear_num', label: 'Date', re: /\b(?:0?[1-9]|1[0-2])[\/-](?:19|20)\d{2}\b/g, replace: () => '[DATE]' },

  { id: 'facility', label: 'Facility name', re: /\b(?:[A-Z][A-Za-z'&.’-]+\s+){1,4}(?:Hospital|Medical\s+Center|Clinic|Health(?:care)?\s+System|Cancer\s+Center|Infirmary|Oncology\s+Center)\b/g, replace: () => '[FACILITY]' },
  { id: 'zip', label: 'ZIP code', re: /\b\d{5}(?:-\d{4})?\b(?=\s*$|\s*[,.;]|\s+(?:USA|United States))/gm, replace: () => '[ZIP]' },
  { id: 'address', label: 'Street address', re: /\b\d{1,6}\s+(?:[A-Z][a-z]+\.?\s){1,4}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir)\b\.?/g, replace: () => '[ADDRESS]' },

  { id: 'age_suffix', label: 'Age >89', re: /\b(?:9\d|1[01]\d)[\s-]*(?:years?[\s-]*old|y\/?o|yo)\b/gi, replace: () => '[AGE 90+]' },
  { id: 'age_labeled', label: 'Age >89', re: /\b(?:at\s+)?age[\s:]+(?:9\d|1[01]\d)\b/gi, replace: () => 'age [90+]' },
  { id: 'age_aged', label: 'Age >89', re: /\baged\s+(?:9\d|1[01]\d)\b/gi, replace: () => 'aged [90+]' },
  // "92F"/"95M" demographic shorthand, but NOT Fahrenheit temperatures ("temp 101F", "T 99 F")
  { id: 'age_shorthand', label: 'Age >89', re: /(?<!(?:[Tt]emp|[Tt]max|[Tt])\.?\s{0,3})(?<![°.\d])\b(?:9\d|1[01]\d)[MF]\b(?!\w)/g, replace: () => '[AGE 90+]' },

  // dropped bare PA/MD/DO — they collide with clinical terms (posteroanterior, "MD Anderson", "DO NOT")
  { id: 'name_cred_prefix', label: 'Name (credentialed)', re: R('\\b(?:NP|PA-C|RN|APRN|CRNA|LPN|LVN|MSW|LICSW|CNM)\\.?\\s+' + NAME + '(?:\\s+' + NAME + '){0,2}\\b', 'g'), replace: (m: string) => (m.match(/^\S+/)?.[0] || '') + ' [NAME]' },
  { id: 'name_cred_suffix', label: 'Name (credentialed)', re: R('\\b' + NAME + '(?:\\s+[A-Z]\\.?)?(?:\\s+' + NAME + '){1,2}\\s*,\\s*(?:MD|DO|NP|PA-C|PA|RN|APRN|CRNA|PharmD|DNP|MBBS|FACP|PhD|MPH)\\b', 'g'), replace: (m: string) => '[NAME]' + m.slice(m.lastIndexOf(',')) },
  { id: 'name_signature', label: 'Name (signature)', re: R('\\b(?:Electronically\\s+signed\\s+by|Signed\\s+by|Cosigned\\s+by|Dictated\\s+by|Transcribed\\s+by|Seen\\s+by|Evaluated\\s+by|Examined\\s+by)\\s*:?\\s*' + NAME + '(?:\\s*,?\\s+' + NAME + '){0,3}', 'gi'), replace: (m: string) => (m.match(/^[\s\S]*?\bby\b/i)?.[0] || m) + ' [NAME]' },
  // all-caps honorifics (MR/MS/DR…) REQUIRE a period so "MS Contin", "DR Grade 3", "MR seen" don't over-redact
  { id: 'name_titled', label: 'Name (with title)', re: R('\\b(?:(?:Mr|Mrs|Ms|Dr|Prof|Rev|Sir|Miss)\\.?|(?:MR|MRS|MS|DR|PROF|REV|SIR|MISS)\\.)\\s+' + NAME + '(?:\\s+' + NAME + '){0,2}', 'g'), replace: (m: string) => m.split(/\s+/)[0].replace(/\.$/, '') + ' [NAME]' },
  { id: 'name_labeled', label: 'Name (labeled field)', re: R('\\b(?:Patient(?:\\s*Name)?|Pt\\s*Name|Provider(?:\\s*Name)?|Physician|Attending(?:\\s*Physician)?|Referring(?:\\s*Physician)?|Ordering\\s+Physician|PCP|Author|Resident|Fellow)\\s*[:#]\\s*' + NAME + '(?:\\s*,?\\s+' + NAME + '){0,3}', 'gi'), replace: (m: string) => { const i = m.search(/[:#]/); return m.slice(0, i + 1) + ' [NAME]' } },

  { id: 'location', label: 'Location (city/state)', re: R("\\b[A-Z][A-Za-z.'\\u2019-]+(?:\\s+[A-Z][A-Za-z.'\\u2019-]+){0,2},\\s*" + STATE + '\\b(?:\\s+\\d{5}(?:-\\d{4})?)?|\\b[A-Z][A-Za-z.\'\\u2019-]+\\s+' + STATE + '\\s+\\d{5}(?:-\\d{4})?\\b', 'g'), replace: () => '[LOCATION]' },
]

export function scan(text: string): DeidScan {
  if (!text) return { findings: [], total: 0 }
  const merged: Record<string, DeidFinding> = {}
  let total = 0
  RULES.forEach((rule) => {
    const re = new RegExp(rule.re.source, rule.re.flags)
    let m: RegExpExecArray | null
    let n = 0
    while ((m = re.exec(text)) !== null) {
      n++
      if (m.index === re.lastIndex) re.lastIndex++
    }
    if (n > 0) {
      if (!merged[rule.label]) merged[rule.label] = { label: rule.label, count: 0 }
      merged[rule.label].count += n
      total += n
    }
  })
  return {
    findings: Object.keys(merged).map((k) => merged[k]).sort((a, b) => b.count - a.count),
    total,
  }
}

export function redact(text: string): { text: string; count: number } {
  if (!text) return { text: '', count: 0 }
  let count = 0
  let out = text
  RULES.forEach((rule) => {
    const re = new RegExp(rule.re.source, rule.re.flags)
    out = out.replace(re, (...args: string[]) => {
      count++
      return rule.replace(...args)
    })
  })
  return { text: out, count }
}

const TOK_OPEN = '@@DEID_OPEN@@'
const TOK_CLOSE = '@@DEID_CLOSE@@'
export function preview(text: string): string {
  if (!text) return ''
  let marked = text
  RULES.forEach((rule) => {
    const re = new RegExp(rule.re.source, rule.re.flags)
    marked = marked.replace(re, (...args: string[]) => TOK_OPEN + rule.replace(...args) + TOK_CLOSE)
  })
  const e = marked.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return e.split(TOK_OPEN).join('<mark class="deid-hit">').split(TOK_CLOSE).join('</mark>').replace(/\n/g, '<br>')
}

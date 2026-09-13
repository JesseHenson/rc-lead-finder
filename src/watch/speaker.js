// Who is speaking, for any trade. The service a post is about comes from the
// owner's profile; the question of whether the author is a customer does not
// depend on the trade at all.

export const normText = text =>
  String(text ?? "").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

// Order matters: the first match names the reason. "Strong" gates fire even
// against a real ask (they are unambiguous business signals); "weak" gates
// only override Claude when there was no ask wording at all — see findings.js
// saveFindings, which keeps a weak-gated lead when check.ask is true.
const GATES = [
  [/\bfully insured\b|\b(we're|we are|i'm|i am) (licensed|insured|bonded)\b|\bllc\b|\b(family|veteran|locally)[ /-]*owned\b|\bwe offer\b|\bcall us\b|\btext us\b|\bservices? offer|\b(i'm|i am) the owner of\b|\b(pm|dm|message|text|call) me for\b|\bbook (now|today)\b|\bnow booking\b|\d+\s?% off\b|\b(labor day|holiday|limited[- ]time) special\b/i,
    "a business advertising", "competitor", true],
  [/\bour (team|crew|services|company)\b|\bfree (quotes?|estimates?)\b/i,
    "a business advertising", "competitor", false],
  [/\b(looking|trying) to (make|earn) (some )?(extra )?(money|cash)\b|\bside hustle\b|\bhelp(ing)? out around the neighborhood\b|\blooking to pick up (some )?(work|jobs|side work)\b|\bnot afraid to get my hands dirty\b|\blet me earn it\b/i,
    "someone offering to do the work", "competitor", true],
  [/\bnow hiring\b|\bwe're hiring\b|\bwe are hiring\b|\bjoin our team\b|\bapply (now|today)\b|\bwe are looking for a (reliable |experienced )?(technician|employee|helper|crew member)\b/i,
    "a business hiring", "noise", true],
  [/\bstart(ing)? (a|an|my|our|own)\b[^.?!]{0,30}\b(business|company)\b|\bgetting started\b|\bfor (a|my) new business\b|\bmy (first|next)\b[^.?!]{0,25}\bjobs?\b|\b(price|pricing) my\b|\bmy (business|company|rig|trailer|clients|customers)\b|\b\d+\s?gpm\b|\b\d{3,4}\s?psi\b|\bsurface cleaner\b|\bskid\b/i,
    "an operator talking shop", "noise", false],
  [/\bto buy\b|\bto purchase\b|\bfor home use\b|\bwhich (brand|model)\b|\bbest (brand|model)\b/i,
    "shopping for equipment, not the service", "noise", false],
];

export function speakerGate(text) {
  const t = normText(text);
  for (const [re, reason, becomes, strong] of GATES) if (re.test(t)) return { reason, becomes, strong };
  return null;
}

// Customer intent. "ISO", "recs" and "raves" are how asks are titled in local groups.
const ASK = /\biso\b|\brecs?\b|\braves?\b|\b(can|could|does|would) anyone recommend\b|\bany(one)? (recommend|recommendations?|suggestions?|referrals?)\b|\bwho do (you|y'?all|people|folks) (use|recommend|like)\b|\banyone (know|used?|have)\b[^.?!]{0,40}\b(guy|gal|company|someone|somebody|service|person|business|pro|contractor|good|reliable|reasonable|affordable)\b|\blooking for (a |an |someone|somebody|recommendations?|quotes?|referrals?)|\bneed (a |an |someone|somebody|recommendations?|quotes?)|\b(get|getting) (a )?quotes?\b|\bhow much (should|does|did|would|will|do) (it|this|that|you|y'?all|people)\b|\bwhat('s| is) a (fair|good|reasonable) price\b/i;

export const isAsk = text => ASK.test(normText(text));

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Word start only — no trailing \b, which is the bug that missed plurals and
// "-ing" forms before. Spaces in a keyword also match a hyphen or nothing.
function keywordRe(keyword) {
  const body = escape(normText(keyword).toLowerCase()).replace(/ /g, "[\\s-]?");
  return new RegExp(`\\b${body}`, "i");
}

export function detectService(text, services = []) {
  const t = normText(text);
  const ordered = [...services].sort((a, b) => (a.kind === "offered" ? 0 : 1) - (b.kind === "offered" ? 0 : 1));
  for (const s of ordered) {
    const words = [s.name, ...(s.keywords || [])].filter(Boolean);
    if (words.some(w => keywordRe(w).test(t))) return { name: s.name, kind: s.kind };
  }
  return null;
}

export function leadCheck(text, services) {
  return { gate: speakerGate(text), ask: isAsk(text), service: detectService(text, services) };
}

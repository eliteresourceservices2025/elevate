import type { CallSeed } from "./schema";

// Lint for the call bank: the same kind of checks the exam questions get, run by the content tests and again when a course is
// published. Returns a list of problems (empty means fine). Pure.

const textsOf = (value: unknown): string[] => (typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(textsOf) : value && typeof value === "object" ? Object.values(value).flatMap(textsOf) : []);

export function callsLint(calls: CallSeed[], moduleKeys: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    if (seen.has(c.key)) out.push(`Duplicate call key: ${c.key}`);
    seen.add(c.key);
    if (!moduleKeys.includes(c.moduleKey)) out.push(`${c.key}: unknown module "${c.moduleKey}"`);
    const ids = c.steps.map((s) => s.id);
    if (new Set(ids).size !== ids.length) out.push(`${c.key}: two steps share an id`);
    for (const s of c.steps) {
      const best = s.choices.filter((x) => x.points === 3).length;
      if (best !== 1) out.push(`${c.key} step ${s.id}: needs exactly one 3-point reply (has ${best})`);
      if (!s.choices.some((x) => x.points === 0)) out.push(`${c.key} step ${s.id}: needs a 0-point reply`);
      const choiceIds = s.choices.map((x) => x.id);
      if (new Set(choiceIds).size !== choiceIds.length) out.push(`${c.key} step ${s.id}: two replies share an id`);
    }
    for (const t of textsOf(c)) {
      const short = t.length > 40 ? `${t.slice(0, 40)}...` : t;
      if (/[<>]/.test(t)) out.push(`${c.key}: markup characters are not allowed: "${short}"`);
      if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) out.push(`${c.key}: looks like a social security number: "${short}"`);
      if (/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/.test(t)) out.push(`${c.key}: looks like a phone number: "${short}"`);
      if (/https?:\/\//i.test(t)) out.push(`${c.key}: web address in course text: "${short}"`);
      for (const hit of t.match(/[a-z0-9.-]+\.(com|org|net|io|ph|gov)\b/gi) ?? []) out.push(`${c.key}: looks like a real web or email address: ${hit}`);
    }
  }
  const medical = calls.filter((c) => c.medical).length;
  const need = calls.length >= 5 ? 2 : 1;
  if (calls.length > 0 && medical < need) out.push(`The pool needs at least ${need} medical call${need === 1 ? "" : "s"} (has ${medical})`);
  return out;
}

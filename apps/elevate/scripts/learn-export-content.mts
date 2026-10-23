// Writes each ELEVATE Learn course as a plain reading document for reviewers (counsel, the Privacy Officer):
//   pnpm learn:export            -> docs/learn/review/<course>-course.md
// The lessons, knowledge checks, scenarios, the exam rules and the whole exam bank with answers and reasons. The files contain
// the exam answer key, so they stay in the private repository and are not given to learners.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COURSES } from "../../learn/src/content";
import type { Block, CourseContent, QuestionSeed } from "../../learn/src/content/schema";

const out = resolve(import.meta.dirname, "../../../docs/learn/review");
mkdirSync(out, { recursive: true });

const bullets = (items: string[], ordered = false) => items.map((t, i) => `${ordered ? `${i + 1}.` : "-"} ${t}`).join("\n");
const quote = (t: string) => t.split("\n").map((l) => `> ${l}`).join("\n");

function block(b: Block): string {
  switch (b.type) {
    case "paragraph":
      return b.text;
    case "list":
      return bullets(b.items, b.ordered);
    case "callout":
      return quote(`**${b.tone.toUpperCase()}${b.title ? `: ${b.title}` : ""}**  \n${b.text}`);
    case "compare":
      return `**${b.left.title}**\n${bullets(b.left.items)}\n\n**${b.right.title}**\n${bullets(b.right.items)}`;
    case "steps":
      return b.items.map((s, i) => `${i + 1}. **${s.title}**: ${s.text}`).join("\n");
    case "scenario":
      return `**Scenario: ${b.title}**\n\n${b.prompt}\n\n${b.choices.map((c) => `- ${c.best ? "(best) " : ""}${c.text}  \n  _${c.feedback}_`).join("\n")}`;
    case "case":
      return `**Case: ${b.title}**\n\n${b.scenario}\n\n_Question:_ ${b.question}\n\n_Answer:_ ${b.answer}`;
    case "table":
      return [b.caption ? `**${b.caption}**` + '\n' : '', `| ${b.columns.join(' | ')} |`, `| ${b.columns.map(() => '---').join(' | ')} |`, ...b.rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
    case "layers":
      return [b.title ? `**${b.title}**` : '', ...b.items.map((i) => `- **${i.label}**: ${i.text}`)].filter(Boolean).join('\n');
    case "timeline":
      return [b.title ? `**${b.title}**` : '', ...b.items.map((i, n) => `${n + 1}. **${i.when}**: ${i.text}`)].filter(Boolean).join('\n');
    case "glossary":
      return ['**Terms**', ...b.terms.map((t) => `- **${t.term}**: ${t.meaning}`)].join('\n');
    case "sort":
      return `**Sort it: ${b.title}**\n\n${b.prompt}\n\n${bullets(b.items, true)}\n\n_${b.explanation}_`;
    case "cards":
      return `**Cards: ${b.title}** (${b.groups.join(" / ")})\n\n${b.prompt}\n\n${b.cards.map((c) => `- ${c.text} -> **${b.groups[c.group]}**  \n  _${c.feedback}_`).join("\n")}`;
    case "spot":
      return `**Spot the mistake: ${b.title}**\n\n${b.prompt}\n\n${b.lines.map((l) => `- ${l.wrong ? "(the mistake) " : ""}**${l.speaker}:** ${l.text}`).join("\n")}\n\n_${b.explanation}_`;
    case "flip":
      return [b.title ? `**${b.title}**` : "**Flip cards**", ...b.cards.map((c) => `- **${c.front}**: ${c.back}`)].join("\n");
    case "build":
      return `**Build it: ${b.title}**\n\n${b.prompt}\n\n${b.slots.map((s) => `_${s.label}_\n${s.options.map((o) => `- ${o.correct ? "(right) " : ""}${o.text}  \n  _${o.feedback}_`).join("\n")}`).join("\n\n")}`;
    case "branch":
      return `**Call: ${b.title}**\n\n${b.intro}\n\n${b.turns.map((t, i) => `Turn ${i + 1}, caller: ${t.caller}\n${t.choices.map((c) => `- ${c.text} (mood ${c.mood > 0 ? "+" : ""}${c.mood})  \n  _${c.reply}_`).join("\n")}`).join("\n\n")}`;
    case "game":
      return `**Quiz game: ${b.title}**${b.seconds ? ` (${b.seconds} seconds a round)` : ""}\n\n${b.rounds.map((r) => `${r.question}\n${r.options.map((o) => `- ${o.correct ? "(right) " : ""}${o.text}  \n  _${o.feedback}_`).join("\n")}`).join("\n\n")}`;
    case "check":
      return `**Check yourself:** ${b.question}${b.multiple ? " (select all that apply)" : ""}\n\n${b.options.map((o) => `- ${o.correct ? "(correct) " : ""}${o.text}  \n  _${o.feedback}_`).join("\n")}`;
  }
}

function course(slug: string, content: CourseContent, questions: QuestionSeed[], exam: unknown): string {
  const cfg = exam as { passPercent: number; maxTries: number; waitMinutesAfterFail: number; renewalMonths: number; tracks: Record<string, { questions: number }> };
  const lines: string[] = [];
  lines.push(`# ${content.title}`, "", `Course code: \`${slug}\`. Generated for review from the course files; the authoring source is \`apps/learn/src/content/${slug}\`.`, "");
  lines.push("## Rules", "");
  lines.push(
    bullets([
      `Pass mark: ${cfg.passPercent}%. Tries: ${cfg.maxTries}, with a wait of ${cfg.waitMinutesAfterFail} minutes after a failed try. No time limit on the exam.`,
      `Exam length by track: ${Object.entries(cfg.tracks).map(([t, v]) => `${t} ${v.questions} questions`).join(", ")} (drawn at random from the bank below).`,
      `Certificate valid for ${cfg.renewalMonths} months.`,
      `Modules: ${content.modules.length}, about ${content.modules.reduce((n, m) => n + m.estimatedMinutes, 0)} minutes in all. Bank: ${questions.length} questions.`,
    ]),
    "",
  );
  lines.push("## Statement the person accepts after passing", "", quote(content.attestation.text), "", `Version label: ${content.attestation.version}`, "");
  content.modules.forEach((m, mi) => {
    lines.push(`## Module ${mi + 1}: ${m.title}`, "", `_${m.summary}_`, "", `About ${m.estimatedMinutes} minutes. Included in tracks: ${m.tracks.join(", ")}.`, "");
    lines.push("Key points:", bullets(m.keyPoints), "");
    m.screens.forEach((s, si) => {
      lines.push(`### ${mi + 1}.${si + 1} ${s.title}`, "");
      for (const b of s.blocks) lines.push(block(b), "");
    });
  });
  lines.push("## Exam bank", "", "Each entry shows the question, the options, the correct answer(s) and the reason shown after a pass.", "");
  const byModule = new Map<string, QuestionSeed[]>();
  for (const x of questions) byModule.set(x.moduleKey, [...(byModule.get(x.moduleKey) ?? []), x]);
  let n = 0;
  for (const m of content.modules) {
    const list = byModule.get(m.key) ?? [];
    if (list.length === 0) continue;
    lines.push(`### ${m.title} (${list.length} questions)`, "");
    for (const x of list) {
      n += 1;
      lines.push(`**Q${n}. [${x.topic}]** ${x.stem}`, "");
      for (const o of x.options) lines.push(`- ${x.correctIds.includes(o.id) ? "(correct) " : ""}${o.id.toUpperCase()}. ${o.text}`);
      lines.push("", `_Reason: ${x.rationale}_`, "");
    }
  }
  return lines.join("\n");
}

for (const def of Object.values(COURSES)) {
  const file = resolve(out, `${def.slug}-course.md`);
  writeFileSync(file, course(def.slug, def.content, def.questions, def.examConfig));
  console.log(`Wrote ${file}`);
}

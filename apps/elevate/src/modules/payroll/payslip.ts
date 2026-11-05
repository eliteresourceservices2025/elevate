import { EXTRA_KEYS, type LineInput, type LineResult } from "./calculate";
import { EXTRA_KEY_ITEM, PAYSLIP_LABELS as L, PAY_ITEM_LABELS } from "./constants";
import { formatPesos } from "./money";

// The payslip as Markdown, pure. It holds the person's own figures from their frozen run lines and nothing else: no other person, no
// Preparer or Approver, no reason typed by staff, no change history, no bank detail. The Markdown goes through parseMarkdown to the PDF.

export type PayslipLine = { alias: string | null; input: LineInput; result: LineResult };
export type PayslipInput = {
  /** The person's own name. */
  name: string;
  periodStart: string;
  periodEnd: string;
  usdRateE4: number | null;
  lines: PayslipLine[];
};

/** Takes out what the Markdown parser would read as formatting, and flattens line breaks. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/[*_`#[\]\\<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const money = (c: bigint) => formatPesos(c);

function rate(e4: number): string {
  const whole = Math.floor(e4 / 10_000);
  let frac = String(e4 % 10_000).padStart(4, "0");
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${whole}.${frac}`;
}

const hoursAndMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} h` : "", m > 0 ? `${m} min` : ""].filter(Boolean).join(" ");
};

const dayText = (hundredths: number) => `${(hundredths / 100).toFixed(2).replace(/\.?0+$/, "")} ${hundredths === 100 ? "day" : "days"}`;

function lineItems(line: PayslipLine): string[] {
  const { input, result } = line;
  const items: string[] = [`- ${L.base}: **${money(result.base)}**`];
  if (result.absences !== 0n) items.push(`- ${PAY_ITEM_LABELS.absence_days} (${dayText(input.absenceDayHundredths)}): **-${money(result.absences)}**`);
  if (result.late !== 0n) items.push(`- ${PAY_ITEM_LABELS.late_minutes} (${input.lateMinutes} min): **-${money(result.late)}**`);
  for (const key of EXTRA_KEYS) {
    if (result.extra[key] === 0n && input.extra[key] === 0) continue;
    items.push(`- ${PAY_ITEM_LABELS[EXTRA_KEY_ITEM[key]]} (${hoursAndMinutes(input.extra[key])}): **${money(result.extra[key])}**`);
  }
  if (input.pesoAllowance !== 0n) items.push(`- ${PAY_ITEM_LABELS.peso_allowance}: **${money(input.pesoAllowance)}**`);
  if (input.dollarAllowanceCents !== 0n) items.push(`- ${PAY_ITEM_LABELS.dollar_allowance} (${formatPesos(input.dollarAllowanceCents)} dollars): **${money(result.dollarAllowancePesos)}**`);
  if (input.adjustment !== 0n) items.push(`- ${PAY_ITEM_LABELS.adjustment}: **${money(input.adjustment)}**`);
  if (input.loan !== 0n) items.push(`- ${PAY_ITEM_LABELS.loan}: **-${money(input.loan)}**`);
  if (input.otherDeductions !== 0n) items.push(`- ${PAY_ITEM_LABELS.other_deduction}: **-${money(input.otherDeductions)}**`);
  items.push(`- ${L.net}: **${money(result.net)}**`);
  return items;
}

/** The payslip for one person and one run: every one of their lines, and a total when there is more than one. */
export function payslipMarkdown(input: PayslipInput): string {
  const parts: string[] = [
    `# ${L.documentTitle}`,
    `${L.preparedFor} **${stripMarkdown(input.name)}**. ${L.period}: **${input.periodStart} to ${input.periodEnd}**.`,
  ];
  if (input.usdRateE4 !== null && input.lines.some((l) => l.input.dollarAllowanceCents !== 0n)) parts.push(`${L.dollarRate}: **${rate(input.usdRateE4)}** pesos per dollar.`);
  input.lines.forEach((line, i) => {
    const alias = line.alias ? stripMarkdown(line.alias) : "";
    const heading = input.lines.length > 1 ? L.lineHeading(alias || String(i + 1)) : alias ? L.lineHeading(alias) : L.details;
    parts.push(`## ${heading}`, lineItems(line).join("\n"));
  });
  if (input.lines.length > 1) parts.push(`## ${L.total}`, `**${money(input.lines.reduce((s, l) => s + l.result.net, 0n))}**`);
  return parts.join("\n\n");
}

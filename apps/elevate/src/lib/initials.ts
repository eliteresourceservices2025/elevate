/**
 * The letters shown in a profile badge. A name gives the first letter of the first and last word ("Ana Reyes" -> "AR", "Ana" -> "A").
 * With no name it falls back to the email's local part, split on dots, dashes and underscores ("juan.dela-cruz@x.com" -> "JD").
 */
export function initialsOf(name: string | null | undefined, email: string): string {
  const words = (name ?? "").split(/\s+/).filter(Boolean);
  const pick = (parts: string[]) => {
    const first = parts[0]?.charAt(0) ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
    return `${first}${last}`.toUpperCase();
  };
  if (words.length > 0) return pick(words);
  const local = email.split("@")[0] ?? "";
  // Only parts that start with a letter count, so "e2e.hr.1791.2f3c" gives E and F, never a number.
  const parts = local.split(/[._\-+]+/).filter((p) => /^\p{L}/u.test(p));
  const fromEmail = pick(parts);
  return fromEmail || "?";
}

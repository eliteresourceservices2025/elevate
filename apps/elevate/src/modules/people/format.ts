// Pure display helpers shared by server and client code.

type Named = { legalFirstName: string; legalLastName: string; preferredName?: string | null };

/** "Maria Santos", or "Mia Santos" when a preferred name is set. */
export function displayName(p: Named): string {
  return `${p.preferredName?.trim() || p.legalFirstName} ${p.legalLastName}`.trim();
}

export function legalName(p: Named & { legalMiddleName?: string | null }): string {
  return [p.legalFirstName, p.legalMiddleName, p.legalLastName].filter(Boolean).join(" ");
}

export function initials(p: Named): string {
  return `${(p.preferredName?.trim() || p.legalFirstName)[0] ?? ""}${p.legalLastName[0] ?? ""}`.toUpperCase();
}

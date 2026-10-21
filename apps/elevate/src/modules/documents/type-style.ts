import { BadgeCheck, ClipboardList, File, FileSignature, FileUser, FolderInput, GraduationCap, IdCard, Lock, ScrollText, SearchCheck, ShieldCheck, type LucideIcon } from "lucide-react";

// How a document type looks. The colour tells the CATEGORY apart at a glance (identity and checks, training, agreements, company, other)
// and the icon tells the type. A type HR adds later falls back to "Other" until it is given a place here. Class names are written out in
// full so Tailwind finds them, with a dark-mode variant of each.

export type DocumentCategory = "identity" | "training" | "agreements" | "company" | "other";

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identity: "Identity and checks",
  training: "Training",
  agreements: "Agreements and signed documents",
  company: "Company",
  other: "Other",
};

export const CATEGORY_STYLES: Record<DocumentCategory, string> = {
  identity: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-200",
  training: "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-400/40 dark:bg-violet-400/15 dark:text-violet-200",
  agreements: "border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-400/40 dark:bg-sky-400/15 dark:text-sky-200",
  company: "border-teal-300 bg-teal-100 text-teal-900 dark:border-teal-400/40 dark:bg-teal-400/15 dark:text-teal-200",
  other: "border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-400/40 dark:bg-slate-400/15 dark:text-slate-200",
};

const TYPES: Record<string, { category: DocumentCategory; icon: LucideIcon }> = {
  nbi_clearance: { category: "identity", icon: ShieldCheck },
  government_id: { category: "identity", icon: IdCard },
  background_check: { category: "identity", icon: SearchCheck },
  hipaa_training: { category: "training", icon: GraduationCap },
  training_certificate: { category: "training", icon: BadgeCheck },
  contract: { category: "agreements", icon: FileSignature },
  signed_document: { category: "agreements", icon: FileSignature },
  client_confidentiality: { category: "agreements", icon: Lock },
  unsorted_employee: { category: "other", icon: FolderInput },
  unsorted_company: { category: "company", icon: FolderInput },
  resume: { category: "other", icon: FileUser },
  other_employee: { category: "other", icon: File },
  company_policy: { category: "company", icon: ScrollText },
  company_form: { category: "company", icon: ClipboardList },
  company_other: { category: "company", icon: File },
};

export function typeStyle(slug: string): { category: DocumentCategory; icon: LucideIcon; className: string } {
  // eslint-disable-next-line security/detect-object-injection -- slug is only used as a key into this fixed map, with a fallback
  const t = Object.hasOwn(TYPES, slug) ? TYPES[slug] : { category: "other" as const, icon: File };
  return { ...t, className: CATEGORY_STYLES[t.category] };
}

/** Every type slug that has its own style (a test checks that every type the database is seeded with is here). */
export const KNOWN_TYPE_SLUGS = Object.keys(TYPES);

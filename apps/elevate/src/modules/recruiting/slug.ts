// Readable web addresses for job ads (/careers/virtual-assistant-medical-billing). Pure: used by the form, the server and the tests.

export const SLUG_MAX = 60;
/** Lower-case words joined by single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A web address from a title: accents removed, letters and numbers only, words joined by dashes, at most 60 characters. */
export function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = base.slice(0, SLUG_MAX).replace(/-+$/g, "");
  return cut || "job";
}

/** The first address from `base` that is not taken: base, base-2, base-3, ... (the cut keeps the whole thing within the limit). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, SLUG_MAX - 7)}-${Date.now().toString(36).slice(-6)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const looksLikeId = (value: string): boolean => UUID.test(value);

/** The public path of an ad: the readable address when it has one, otherwise the id. */
export const careerPath = (opening: { id: string; slug: string | null }): string => `/careers/${opening.slug ?? opening.id}`;

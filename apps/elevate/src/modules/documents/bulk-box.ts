/**
 * Checkbox attributes for a document row; the bulk bar reads the ticked boxes from the page.
 * Kept out of the bar's "use client" file so Server Components can call it.
 */
export const bulkBoxProps = (formId: string) => ({ type: "checkbox" as const, form: formId, name: "document" });

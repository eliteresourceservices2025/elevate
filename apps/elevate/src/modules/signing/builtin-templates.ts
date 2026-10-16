// Ready-made documents HR can start from on "Send a document" (Write or paste it here). Plain data, no database: the text is copied
// into the editor, where HR can still change it before sending. Each becomes an ordinary envelope (PDF in the ELITE letterhead,
// fingerprinted, signed and sealed). Text is Markdown: "#" lines are the numbered section headings, "**" is bold.

export type BuiltinTemplate = {
  id: string;
  /** Name in the picker. */
  name: string;
  description: string;
  /** Title printed centered under the logo (and the default document title). */
  title: string;
  /** Who signs, in order (the role shown beside each person). */
  roles: string[];
  body: string;
};

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: "time-off-policy",
    name: "Personal Time Off (PTO) Policy",
    description: "Unpaid personal time off for contractors: notice, client approval, proof to the Team Lead.",
    title: "Personal Time Off (PTO) Policy",
    roles: ["Contractor"],
    body: `At ELITE Resource Services, we recognize the importance of balancing professional responsibilities with personal needs. While our contractors are expected to maintain consistent client coverage, we also value transparency and proper planning when time off is required. This policy provides clear guidelines for requesting and documenting unpaid Personal Time Off (PTO) to ensure smooth operations and accountability.

# 1. Purpose

This policy outlines the guidelines for requesting and approving unpaid Personal Time Off (PTO) to balance contractor flexibility with client coverage needs.

# 2. Eligibility

All independent contractors engaged by ELITE Resource Services may request Personal Time Off in accordance with this policy.

# 3. Notice Requirements

- **Single-Day PTO Requests:** Must be submitted at least 7 calendar days in advance.
- **Multi-Day PTO Requests (2 or more consecutive days):** Must be submitted at least 14 calendar days in advance.

# 4. Approval Process

- Contractors must first obtain client approval for their requested PTO.
- Once approved, contractors must send a screenshot of the client's approval to their respective Team Lead for record-keeping and scheduling purposes.
- PTO is considered valid only after the Team Lead has received and acknowledged the approval screenshot.
- **Failure to Submit Proof:** If the screenshot of client approval is not provided to the Team Lead, the PTO will be considered unapproved and treated as an absence.

# 5. General Guidelines

- PTO is unpaid and does not accrue or carry over.
- Unapproved absences may be treated as non-performance and may result in corrective action.
- PTO does not alter the independent contractor relationship and does not entitle contractors to employee benefits.

We value professionalism, accountability, and respect for client commitments. By following this PTO policy, contractors help maintain smooth operations while ensuring their personal needs are managed responsibly. Adherence to this policy is expected from all contractors and will be enforced consistently to uphold service quality and reliability.`,
  },
];

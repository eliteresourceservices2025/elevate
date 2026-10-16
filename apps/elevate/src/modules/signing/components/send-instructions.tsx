/**
 * A fixed note beside the "Send a document" form: what to do before sending. It stays in view while HR scrolls the editor (on wide
 * screens) and sits above the form on narrow ones. Plain text, the same for every document.
 */
export function SendInstructions() {
  return (
    <aside aria-label="Before you send" className="space-y-3 rounded-xl border bg-card p-4 text-sm lg:sticky lg:top-4">
      <h2 className="text-base font-semibold">Before you send</h2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Choose the document.</strong> Start from a ready-made one (PTO policy, Handbook, NDA, Independent Contractor Agreement), write or paste your own, or upload a PDF.
        </li>
        <li>
          <strong>Fill in any [[parts in double brackets]].</strong> The document cannot be sent while any remain. (The ready-made documents have none: the NDA carries the Company&apos;s Delaware address.)
        </li>
        <li>
          <strong>Check the details on each person&apos;s profile.</strong> Name, address, role, start date and manager fill in from their record. If one is missing, nothing is sent and you are told who and what.
        </li>
        <li>
          <strong>Type the terms.</strong> For the agreement: monthly compensation, payment frequency, duties, schedule. They are the same for everyone in that send, so send an agreement to one person at a time.
        </li>
        <li>
          <strong>Choose who signs.</strong> Add people one by one, or everyone, a team or a client&apos;s assignees. More than 10 people (or the box ticked) means each person signs their own copy.
        </li>
        <li>
          <strong>Pick the Company countersigner</strong> for the NDA and the agreement. They sign after each person.
        </li>
        <li>
          <strong>Use Preview.</strong> It shows the logo, the centered title and where the details will go.
        </li>
      </ol>
      <h3 className="pt-1 font-semibold">Good to know</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
        <li>The agreement date is the date of the last signature. It is shown on the signature page, not in the text.</li>
        <li>The contractor types their bank details when signing. Only they, HR and Super Admin can open the signed copy.</li>
        <li>A sent document cannot be edited. To change it, void it and send a new one.</li>
        <li>Do not include client or patient information.</li>
      </ul>
    </aside>
  );
}

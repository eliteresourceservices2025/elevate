import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { getUploadOptions, listEmployeeDocuments } from "../queries";
import { DocumentList } from "./document-list";
import { UploadForm } from "./upload-form";

/** The Documents tab on a profile: the person's files, plus the upload form for anyone allowed to add. */
export async function EmployeeDocuments({ employeeId, canUpload }: { employeeId: string; canUpload: boolean }) {
  const user = await requireUser();
  const rows = await listEmployeeDocuments(employeeId);
  const options = canUpload ? await getUploadOptions("employee", employeeId) : null;
  const today = formatInZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      <DocumentList rows={rows} viewerIsHr={can(user, "documents.verify")} emptyText="No documents uploaded yet." />
      {options ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Upload a document</h2>
          <UploadForm target="employee" employeeId={employeeId} types={options.types} clients={options.clients} today={today} />
        </section>
      ) : null}
    </div>
  );
}

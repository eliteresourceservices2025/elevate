import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { getUploadOptions, listEmployeeDocuments, listEmployeeFolders } from "../queries";
import { DocumentLibrary } from "./document-library";
import { DocumentUploadActions } from "./document-upload-actions";

/** The Documents tab on a profile: the person's files, plus the upload form for anyone allowed to add. */
export async function EmployeeDocuments({ employeeId, canUpload }: { employeeId: string; canUpload: boolean }) {
  const user = await requireUser();
  const [rows, folders] = await Promise.all([listEmployeeDocuments(employeeId), listEmployeeFolders(employeeId)]);
  const options = canUpload ? await getUploadOptions("employee", employeeId) : null;
  const today = formatInZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Documents</h2>
        {options ? <DocumentUploadActions target="employee" employeeId={employeeId} types={options.types} clients={options.clients} folders={folders} today={today} /> : null}
      </div>
      <DocumentLibrary employeeId={employeeId} rows={rows} folders={folders} canOrganize={canUpload} viewerIsHr={can(user, "documents.verify")} categorize={options ? { types: options.types, clients: options.clients, today } : undefined} />
    </div>
  );
}

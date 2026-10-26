import { Files, Upload } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import type { TypeOption } from "../queries";
import { BulkUpload } from "./bulk-upload";
import { UploadForm } from "./upload-form";

/** Entry points stay above the library; each upload flow has its own draft and progress. */
export function DocumentUploadActions({
  target,
  employeeId,
  types,
  clients,
  folders = [],
  today,
}: {
  target: "employee" | "company";
  employeeId?: string;
  types: TypeOption[];
  clients: { id: string; name: string }[];
  folders?: { id: string; name: string }[];
  today: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Upload documents">
      <FormDialog
        label="Upload a document"
        title="Upload a document"
        size="lg"
        icon={<Upload aria-hidden className="size-4" />}
      >
        <UploadForm
          target={target}
          employeeId={employeeId}
          types={types}
          clients={clients}
          folders={folders}
          today={today}
        />
      </FormDialog>
      {types.some((t) => t.slug === `unsorted_${target}`) ? (
        <FormDialog
          label="Upload many files"
          title="Upload many files"
          size="lg"
          variant="outline"
          icon={<Files aria-hidden className="size-4" />}
        >
          <BulkUpload target={target} employeeId={employeeId} types={types} />
        </FormDialog>
      ) : null}
    </div>
  );
}

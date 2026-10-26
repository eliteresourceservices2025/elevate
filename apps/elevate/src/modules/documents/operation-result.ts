import type { OperationResult } from "@/components/operation-result";
import type { BulkDocumentsResult } from "./actions";

export function documentOperationResult(
  action: "archive" | "restore" | "delete",
  result: BulkDocumentsResult,
  labels: ReadonlyMap<string, string>,
): OperationResult {
  const verb =
    action === "archive" ? "archived" : action === "restore" ? "restored" : "deleted permanently";
  const failed = result.failed.length;
  return {
    title: failed
      ? result.done > 0
        ? "Some documents need attention"
        : "Documents could not be changed"
      : "Documents updated",
    description: `${result.done} of ${result.requested} ${result.requested === 1 ? "document" : "documents"} ${verb}.${failed ? ` ${failed} could not be changed. Review the details and try those files again.` : action === "archive" ? " The files are kept and can be restored." : ""}`,
    variant: failed ? (result.done > 0 ? "warning" : "error") : "success",
    details: result.failed.map(
      (item) => `${labels.get(item.documentId) ?? "A selected document"}: ${item.reason}`,
    ),
  };
}

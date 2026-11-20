import { StatusChip, type StatusTone } from "@/components/status-chip";
import { RUN_STATUS_LABELS, type RunStatus } from "../constants";

// A run's status in the one status look (a dot and the word). Draft and cancelled are quiet, review is informational, approved is waiting
// on money, paid is done.
const TONE: Record<RunStatus, StatusTone> = { draft: "neutral", in_review: "info", approved: "warning", paid: "success", cancelled: "neutral" };

export function RunStatusChip({ status }: { status: RunStatus }) {
  return <StatusChip tone={TONE[status]}>{RUN_STATUS_LABELS[status]}</StatusChip>;
}

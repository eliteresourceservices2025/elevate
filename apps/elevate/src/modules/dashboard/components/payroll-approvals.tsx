import Link from "next/link";
import { Banknote } from "lucide-react";
import { payrollRunsAwaitingApproval } from "@/modules/payroll/queries";
import { orFallback } from "../or-fallback";
import { guarded } from "./guard";
import { Panel, PanelList, ROW_LINK } from "./panel";

/**
 * Pay runs waiting for this Approver, beside the other approvals. A count and a link only: never an amount, a name or a period's
 * figures. Payroll access comes from a person's payroll level, not their role, so this shows in every dashboard view.
 */
export async function PayrollApprovals() {
  return guarded("Payroll approvals", async () => {
    const waiting = await orFallback(() => payrollRunsAwaitingApproval(), 0);
    if (waiting === 0) return null;
    return (
      <Panel
        label="Payroll approvals"
        title={
          <>
            <Banknote className="size-5 text-primary" aria-hidden />
            Payroll
          </>
        }
        count={waiting}
      >
        <PanelList>
          <li>
            <Link href="/payroll" className={ROW_LINK}>
              <span className="font-medium">{waiting === 1 ? "1 pay run is waiting for your approval" : `${waiting} pay runs are waiting for your approval`}</span>
            </Link>
          </li>
        </PanelList>
      </Panel>
    );
  });
}

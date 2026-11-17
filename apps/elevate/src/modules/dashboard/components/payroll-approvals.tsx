import Link from "next/link";
import { Banknote } from "lucide-react";
import { payrollRunsAwaitingApproval, payrollRunsAwaitingPayment } from "@/modules/payroll/queries";
import { orFallback } from "../or-fallback";
import { guarded } from "./guard";
import { Panel, PanelList, ROW_LINK } from "./panel";

/**
 * Pay runs waiting for this Approver, and approved runs still waiting to be paid (for the people who record payments), beside the other
 * approvals. Counts, days and a link only: never an amount, a name or a period's figures. Payroll access comes from a person's payroll
 * level, not their role, so this shows in every dashboard view.
 */
export async function PayrollApprovals() {
  return guarded("Payroll approvals", async () => {
    const waiting = await orFallback(() => payrollRunsAwaitingApproval(), 0);
    const toPay = await orFallback(() => payrollRunsAwaitingPayment(), { count: 0, oldestDays: 0 });
    if (waiting === 0 && toPay.count === 0) return null;
    return (
      <Panel
        label="Payroll approvals"
        title={
          <>
            <Banknote className="size-5 text-primary" aria-hidden />
            Payroll
          </>
        }
        count={waiting + toPay.count}
      >
        <PanelList>
          {waiting > 0 ? (
            <li>
              <Link href="/payroll" className={ROW_LINK}>
                <span className="font-medium">{waiting === 1 ? "1 pay run is waiting for your approval" : `${waiting} pay runs are waiting for your approval`}</span>
              </Link>
            </li>
          ) : null}
          {toPay.count > 0 ? (
            <li>
              <Link href="/payroll" className={ROW_LINK}>
                <span className="font-medium">
                  {toPay.count === 1 ? "1 approved pay run is waiting for payment" : `${toPay.count} approved pay runs are waiting for payment`}
                  {toPay.oldestDays > 0 ? ` (approved ${toPay.oldestDays} ${toPay.oldestDays === 1 ? "day" : "days"} ago)` : ""}
                </span>
              </Link>
            </li>
          ) : null}
        </PanelList>
      </Panel>
    );
  });
}

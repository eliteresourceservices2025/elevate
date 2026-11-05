import { TabNav } from "@/components/tab-nav";

// Only the tabs that exist are listed: Task 6 adds Runs, a later task adds History.
const TABS = [
  { key: "rates", label: "Rates", href: "/payroll/rates" },
  { key: "settings", label: "Settings", href: "/payroll/settings" },
];

export function PayrollTabs({ current }: { current: "rates" | "settings" }) {
  return <TabNav label="Payroll sections" items={TABS} current={current} />;
}

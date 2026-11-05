import { TabNav } from "@/components/tab-nav";

// Only the tabs that exist are listed: a later task adds History.
const TABS = [
  { key: "runs", label: "Runs", href: "/payroll" },
  { key: "rates", label: "Rates", href: "/payroll/rates" },
  { key: "settings", label: "Settings", href: "/payroll/settings" },
];

export function PayrollTabs({ current }: { current: "runs" | "rates" | "settings" }) {
  return <TabNav label="Payroll sections" items={TABS} current={current} />;
}

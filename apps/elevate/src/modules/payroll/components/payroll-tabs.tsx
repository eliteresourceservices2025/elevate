import { TabNav } from "@/components/tab-nav";

const TABS = [
  { key: "runs", label: "Runs", href: "/payroll" },
  { key: "rates", label: "Rates", href: "/payroll/rates" },
  { key: "statements", label: "Statements", href: "/payroll/statements" },
  { key: "settings", label: "Settings", href: "/payroll/settings" },
  { key: "history", label: "History", href: "/payroll/history" },
];

export function PayrollTabs({ current }: { current: "runs" | "rates" | "statements" | "settings" | "history" }) {
  return <TabNav label="Payroll sections" items={TABS} current={current} />;
}

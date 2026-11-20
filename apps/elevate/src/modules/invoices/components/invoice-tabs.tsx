import { TabNav } from "@/components/tab-nav";

const TABS = [
  { key: "invoices", label: "Invoices", href: "/invoices" },
  { key: "rates", label: "Billing rates", href: "/invoices/rates" },
];

export function InvoiceTabs({ current }: { current: "invoices" | "rates" }) {
  return <TabNav label="Invoice sections" items={TABS} current={current} />;
}

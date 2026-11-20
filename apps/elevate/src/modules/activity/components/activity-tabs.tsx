import { TabNav } from "@/components/tab-nav";

/** The sections of the Activity pages. Devices is for HR and Super Admin only; Exceptions and Reports come in a later phase. */
export function ActivityTabs({ current, canManage }: { current: "live" | "devices"; canManage: boolean }) {
  const items = [{ key: "live", label: "Live", href: "/activity" }, ...(canManage ? [{ key: "devices", label: "Devices", href: "/activity/devices" }] : [])];
  if (items.length < 2) return null;
  return <TabNav label="Activity sections" items={items} current={current} />;
}

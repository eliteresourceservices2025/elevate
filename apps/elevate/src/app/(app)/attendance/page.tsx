import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Attendance" };

export default function Page() {
  return <ModulePlaceholder href="/attendance" />;
}

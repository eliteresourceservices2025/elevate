import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Org chart" };

export default function Page() {
  return <ModulePlaceholder href="/org-chart" />;
}

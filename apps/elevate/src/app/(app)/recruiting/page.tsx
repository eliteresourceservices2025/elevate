import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Recruiting" };

export default function Page() {
  return <ModulePlaceholder href="/recruiting" />;
}

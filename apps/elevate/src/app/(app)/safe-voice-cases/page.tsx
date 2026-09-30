import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/shell/module-placeholder";

export const metadata: Metadata = { title: "Safe Voice cases" };

export default function Page() {
  return <ModulePlaceholder href="/safe-voice-cases" />;
}

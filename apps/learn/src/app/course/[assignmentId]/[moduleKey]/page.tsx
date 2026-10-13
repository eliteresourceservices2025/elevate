import { notFound } from "next/navigation";
import { ModulePlayer } from "@/components/module-player";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getModuleView } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ModulePage({ params }: { params: Promise<{ assignmentId: string; moduleKey: string }> }) {
  const { assignmentId, moduleKey } = await params;
  const session = await requireSession();
  const view = await getModuleView(getSql(), session.userId, assignmentId, moduleKey);
  if (!view) notFound();
  return (
    <ModulePlayer
      assignmentId={view.assignmentId}
      module={view.module}
      seenScreens={view.seenScreens}
      seconds={view.seconds}
      minSeconds={view.minSeconds}
      completed={view.completed}
      nextModule={view.nextModule}
    />
  );
}

import { notFound } from "next/navigation";
import { ModulePlayer } from "@/components/module-player";
import { findRecap, recapCaptions, recapFile, recapSeconds, recapTranscript } from "@/content/recaps";
import { videosForModule } from "@/content/customer-service/videos";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getModuleView } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lesson" };

export const dynamic = "force-dynamic";

export default async function ModulePage({ params }: { params: Promise<{ assignmentId: string; moduleKey: string }> }) {
  const { assignmentId, moduleKey } = await params;
  const session = await requireSession();
  const view = await getModuleView(getSql(), session.userId, assignmentId, moduleKey);
  if (!view) notFound();
  const found = findRecap(view.courseSlug, view.module.key, view.version);
  const recap = found ? { file: recapFile(found), seconds: recapSeconds(found), transcript: recapTranscript(found), captions: recapCaptions(found) } : null;
  return (
    <ModulePlayer
      assignmentId={view.assignmentId}
      module={view.module}
      onlyScreens={view.onlyScreens}
      seenScreens={view.seenScreens}
      seconds={view.seconds}
      minSeconds={view.minSeconds}
      completed={view.completed}
      nextModule={view.nextModule}
      recap={recap}
      videos={videosForModule(view.courseSlug, view.module.key)}
    />
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addStudioComment, resolveStudioComment } from "../studio-actions";
import type { StudioComment } from "../studio-queries";

/** Notes between editors on a draft: about the whole course or one module. Internal; learners never see them. */
export function StudioComments({ versionId, comments, modules, draft }: { versionId: string; comments: StudioComment[]; modules: { key: string; title: string }[]; draft: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState("course");
  const [body, setBody] = useState("");
  const label = (t: string) => (t === "course" ? "Whole course" : (modules.find((m) => `module:${m.key}` === t)?.title ?? t));
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) return void toast.error(r.error);
        toast.success(done);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  const open = comments.filter((c) => !c.resolved);

  return (
    <section aria-label="Editor comments" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Comments between editors{open.length ? ` (${open.length} open)` : ""}</h2>
      <p className="text-sm text-muted-foreground">Working notes for the people editing this course. Learners never see them. Do not put patient or personal details in a comment.</p>
      {comments.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className={`rounded-lg border p-3 text-sm ${c.resolved ? "opacity-60" : ""}`}>
            <p className="text-xs text-muted-foreground">
              {label(c.target)} · {c.author}
              {c.mine ? " (you)" : ""} · {c.createdAt.slice(0, 10)}
              {c.resolved ? " · resolved" : ""}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            {draft && !c.resolved ? (
              <Button type="button" size="sm" variant="outline" className="mt-2" disabled={pending} onClick={() => run(() => resolveStudioComment({ commentId: c.id }), "Marked as done.")}>
                Mark as done
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {draft ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addStudioComment({ versionId, target, body }), "Comment added.", () => setBody(""));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="comment-target">About</Label>
            <NativeSelect id="comment-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="course">Whole course</option>
              {modules.map((m) => (
                <option key={m.key} value={`module:${m.key}`}>
                  {m.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="comment-body">Comment</Label>
            <Textarea id="comment-body" rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending || body.trim().length < 3}>
            {pending ? "Saving..." : "Add the comment"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

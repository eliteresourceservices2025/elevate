"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createTag, setApplicationSource, setApplicationTags } from "../actions";
import { MAX_TAGS_PER_APPLICATION, SOURCES, SOURCE_LABELS, TAG_NAME_MAX, type Source } from "../constants";
import type { TagChoice } from "../queries";
import { useRun } from "./use-run";

/** Where they heard about the job, and the tags on this application. Everyone who can see the application reads them; recruiters and HR edit. */
export function TagsAndSource({
  applicationId,
  tags,
  choices,
  source,
  sourceDetail,
  canEdit,
}: {
  applicationId: string;
  tags: TagChoice[];
  choices: TagChoice[];
  source: Source | null;
  sourceDetail: string | null;
  canEdit: boolean;
}) {
  const { run, pending } = useRun();
  const [options, setOptions] = useState<TagChoice[]>(choices);
  const [picked, setPicked] = useState<Set<string>>(new Set(tags.map((t) => t.id)));
  const [newName, setNewName] = useState("");
  const [src, setSrc] = useState<string>(source ?? "");
  const [detail, setDetail] = useState(sourceDetail ?? "");

  if (!canEdit) {
    return (
      <section aria-label="Source and tags" className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Source and tags</h2>
        <p className="text-sm">
          <span className="text-muted-foreground">Heard about the job: </span>
          {source ? SOURCE_LABELS[source] : "Not said"}
          {sourceDetail ? ` (${sourceDetail})` : ""}
        </p>
        <div className="flex flex-wrap gap-1">
          {tags.length === 0 ? <span className="text-sm text-muted-foreground">No tags.</span> : tags.map((t) => <Badge key={t.id} variant="outline">{t.name}</Badge>)}
        </div>
      </section>
    );
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function addNew() {
    const name = newName.trim();
    if (!name) return;
    if (picked.size >= MAX_TAGS_PER_APPLICATION) return void toast.error(`At most ${MAX_TAGS_PER_APPLICATION} tags on one application.`);
    const made = await createTag({ name });
    if (!made.ok) return void toast.error(made.error);
    setNewName("");
    setPicked((prev) => new Set(prev).add(made.data.id));
    // The new tag is saved to the list now; it is put on this application when "Save tags" is pressed.
    setOptions((list) => (list.some((c) => c.id === made.data.id) ? list : [...list, made.data]));
    toast.success(`Tag "${made.data.name}" is ready. Press Save tags to put it on this applicant.`);
  }

  return (
    <section aria-label="Source and tags" className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Source and tags</h2>

      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setApplicationSource({ applicationId, source: src, sourceDetail: detail }), "Source saved.");
        }}
      >
        <SelectField id="at-source" label="Heard about the job" value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="">Not said</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </SelectField>
        {src ? <TextField id="at-detail" label="More detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={100} /> : null}
        <div className="flex items-end">
          <Button type="submit" variant="outline" disabled={pending}>
            Save source
          </Button>
        </div>
      </form>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setApplicationTags({ applicationId, tagIds: [...picked] }), "Tags saved.");
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Tags (up to {MAX_TAGS_PER_APPLICATION})</legend>
          {options.length === 0 ? <p className="text-sm text-muted-foreground">No tags yet. Make the first one below.</p> : null}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {options.map((c) => (
              <label key={c.id} htmlFor={`at-tag-${c.id}`} className="flex items-center gap-2 text-sm">
                <input id={`at-tag-${c.id}`} type="checkbox" className="size-4 accent-primary" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-2">
          <TextField id="at-new" label="Make a new tag" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={TAG_NAME_MAX} placeholder="For example: Strong English" />
          <Button type="button" variant="outline" disabled={pending || newName.trim() === ""} onClick={() => void addNew()}>
            Add tag
          </Button>
        </div>
        <Button type="submit" disabled={pending}>
          Save tags
        </Button>
      </form>
    </section>
  );
}

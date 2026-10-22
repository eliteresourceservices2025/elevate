"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { clearMySelfIdentification, saveMySelfIdentification } from "../actions";
import { DEMOGRAPHICS_NOTE } from "../constants";
import type { SelfIdentification } from "../service";
import { SelfIdFields } from "./self-id-fields";

/** "About me": the person's own optional answers, in a pop-up opened from their Personal tab. Pronouns show next to the name; gender, sexual orientation and religion only when the person switches "show on my profile" on. */
export function SelfIdCard({ initial }: { initial: SelfIdentification }) {
  return (
    <FormDialog label="Edit about me" title="About me (optional)" description={DEMOGRAPHICS_NOTE} variant="outline" size="lg">
      <SelfIdForm initial={initial} />
    </FormDialog>
  );
}

function SelfIdForm({ initial }: { initial: SelfIdentification }) {
  const dialog = useFormDialog();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formKey, setFormKey] = useState(0);

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const get = (name: string) => String(f.get(name) ?? "");
    startTransition(async () => {
      const result = await saveMySelfIdentification({
        gender: get("gender"),
        genderOther: get("genderOther"),
        pronouns: get("pronouns"),
        pronounsOther: get("pronounsOther"),
        orientation: get("orientation"),
        orientationOther: get("orientationOther"),
        religion: get("religion"),
        religionOther: get("religionOther"),
        showGender: f.get("showGender") === "on",
        showOrientation: f.get("showOrientation") === "on",
        showReligion: f.get("showReligion") === "on",
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.data.answered > 0 ? "Saved." : "Nothing is saved.");
      dialog?.close(true);
      router.refresh();
    });
  }

  function clear() {
    if (!window.confirm("Remove your gender, pronouns, sexual orientation and religion from ELEVATE?")) return;
    startTransition(async () => {
      const result = await clearMySelfIdentification();
      if (!result.ok) return void toast.error(result.error);
      toast.success("Removed.");
      setFormKey((k) => k + 1);
      dialog?.close(true);
      router.refresh();
    });
  }

  return (
    <form key={formKey} onSubmit={save} className="space-y-4" noValidate>
      <SelfIdFields idPrefix="me" initial={formKey === 0 ? initial : undefined} withPronouns withShare />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={clear}>
          Remove all my answers
        </Button>
      </div>
    </form>
  );
}

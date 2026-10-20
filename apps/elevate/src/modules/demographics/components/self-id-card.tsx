"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearMySelfIdentification, saveMySelfIdentification } from "../actions";
import { DEMOGRAPHICS_NOTE } from "../constants";
import type { SelfIdentification } from "../service";
import { SelfIdFields } from "./self-id-fields";

/** "About me": the person's own optional answers. Only they can see gender and religion; pronouns show next to the name. */
export function SelfIdCard({ initial }: { initial: SelfIdentification }) {
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
        religion: get("religion"),
        religionOther: get("religionOther"),
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.data.answered > 0 ? "Saved." : "Nothing is saved.");
      router.refresh();
    });
  }

  function clear() {
    if (!window.confirm("Remove your gender, pronouns and religion from ELEVATE?")) return;
    startTransition(async () => {
      const result = await clearMySelfIdentification();
      if (!result.ok) return void toast.error(result.error);
      toast.success("Removed.");
      setFormKey((k) => k + 1);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="about-me" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 id="about-me" className="text-base font-semibold">
          About me (optional)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{DEMOGRAPHICS_NOTE}</p>
      </div>
      <form key={formKey} onSubmit={save} className="space-y-4" noValidate>
        <SelfIdFields idPrefix="me" initial={formKey === 0 ? initial : undefined} withPronouns />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={clear}>
            Remove all my answers
          </Button>
        </div>
      </form>
    </section>
  );
}

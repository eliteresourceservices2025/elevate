"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { forgetScheduleImportMatch } from "../actions";

type Alias = { id: string; kind: "person" | "client"; sheetKey: string; target: string; createdAt: Date };

/** Matches HR confirmed on earlier uploads. Removing one makes the next sheet match by name again. */
export function RememberedMatches({ aliases }: { aliases: Alias[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function forget(id: string) {
    setPending(id);
    try {
      const r = await forgetScheduleImportMatch({ aliasId: id });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Forgotten.");
      router.refresh();
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="Remembered matches" className="space-y-2">
      <h2 className="text-lg font-semibold">Remembered matches</h2>
      <p className="text-sm text-muted-foreground">Spellings on the sheet that you matched to a person or client. They are used automatically on later uploads.</p>
      {aliases.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {aliases.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span>
                <span className="text-muted-foreground">{a.kind === "person" ? "Person" : "Client"}:</span> {a.sheetKey} <span className="text-muted-foreground">is</span> <span className="font-medium">{a.target}</span>
              </span>
              <Button size="sm" variant="ghost" disabled={pending === a.id} onClick={() => forget(a.id)}>
                Forget
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

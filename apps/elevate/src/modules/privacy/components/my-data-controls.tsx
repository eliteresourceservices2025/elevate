"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestDataRights } from "@/modules/people/actions";
import { DATA_RIGHTS_KINDS, DATA_RIGHTS_LABELS, type DataRightsKind } from "@/modules/people/constants";
import { exportMyData } from "../actions";

export function DownloadButtons() {
  const [pending, startTransition] = useTransition();
  const download = (format: "json" | "pdf") =>
    startTransition(async () => {
      const result = await exportMyData({ format });
      if (!result.ok) return void toast.error(result.error);
      const bytes = Uint8Array.from(atob(result.data.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.data.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.fileName;
      link.click();
      URL.revokeObjectURL(url);
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={() => download("pdf")}>
        Download PDF
      </Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => download("json")}>
        Download JSON
      </Button>
    </div>
  );
}

export function DataRightsForm({ hasOpenRequest }: { hasOpenRequest: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<DataRightsKind>("correction");
  const [details, setDetails] = useState("");

  if (hasOpenRequest) return <p className="text-sm text-muted-foreground">You have a request waiting for HR. You can send another once it is handled.</p>;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await requestDataRights({ kind, details });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Your request was sent to HR.");
          setDetails("");
          router.refresh();
        });
      }}
    >
      <SelectField id="dr-kind" label="What do you need?" value={kind} onChange={(e) => setKind(e.target.value as DataRightsKind)}>
        {DATA_RIGHTS_KINDS.map((k) => (
          <option key={k} value={k}>
            {DATA_RIGHTS_LABELS[k] /* eslint-disable-line security/detect-object-injection -- k is a DATA_RIGHTS_KINDS member */}
          </option>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <Label htmlFor="dr-details">Tell HR what to do</Label>
        <Textarea id="dr-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={4} maxLength={1000} required />
        <p className="text-xs text-muted-foreground">Do not include passwords or ID numbers here.</p>
      </div>
      <Button type="submit" disabled={pending}>
        Send request
      </Button>
    </form>
  );
}

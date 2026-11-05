"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SIGNATORY_LABELS as S } from "@/modules/payroll/constants";
import { savePayrollSignatory } from "../actions";
import type { PayrollSignatoryView } from "../queries";

// A signature picture is made small in the browser (a JPEG on a white background, at most 600 x 200). The server checks the bytes again
// and removes any metadata before keeping it, so nothing here is trusted.
const MAX_WIDTH = 600;
const MAX_HEIGHT = 200;
const MIN_SIDE = 40;

type Picked = { base64: string; previewUrl: string };

async function toSignatureJpeg(file: File): Promise<Picked> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("not a picture"));
      img.src = url;
    });
    // Keep the picture's own shape: shrink it to fit, and if it is smaller than the server accepts, centre it on a larger white canvas.
    const scale = Math.min(1, MAX_WIDTH / image.naturalWidth, MAX_HEIGHT / image.naturalHeight);
    const drawWidth = Math.max(1, Math.round(image.naturalWidth * scale));
    const drawHeight = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(MIN_SIDE, drawWidth);
    canvas.height = Math.max(MIN_SIDE, drawHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, Math.round((canvas.width - drawWidth) / 2), Math.round((canvas.height - drawHeight) / 2), drawWidth, drawHeight);
    const previewUrl = canvas.toDataURL("image/jpeg", 0.9);
    return { base64: previewUrl.slice(previewUrl.indexOf(",") + 1), previewUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PayrollSignatoryForm({ current }: { current: PayrollSignatoryView | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(current?.name ?? "");
  const [title, setTitle] = useState(current?.title ?? S.titleDefault);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [remove, setRemove] = useState(false);

  const shown = picked?.previewUrl ?? (remove ? null : (current?.signatureDataUrl ?? null));

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      setPicked(await toSignatureJpeg(file));
      setRemove(false);
    } catch {
      toast.error(S.fileError);
    }
  }

  function save() {
    startTransition(async () => {
      const result = await savePayrollSignatory({ name, title, signature: picked?.base64 ?? null, removeSignature: remove && !picked });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(S.saved);
      setPicked(null);
      setRemove(false);
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {current === null ? <Alert variant="info">{S.notSetYet}</Alert> : null}
      {current?.signatureUnreadable ? <Alert variant="warning">{S.unreadable}</Alert> : null}

      <div className="space-y-1">
        <Label htmlFor="signatory-name">{S.name}</Label>
        <Input id="signatory-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoComplete="off" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="signatory-title">{S.title}</Label>
        <Input id="signatory-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required autoComplete="off" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signatory-picture">{S.signature}</Label>
        <Input id="signatory-picture" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void choose(e.target.files?.[0])} />
        <p className="text-xs text-muted-foreground">{S.signatureHint}</p>
        <div className="flex min-h-24 items-center justify-center rounded-lg border bg-white p-3">
          {shown ? (
            // A data URL made here or read from the private database: not a file Next.js can optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt={S.current} className="max-h-24 w-auto" />
          ) : (
            <p className="text-sm text-black/60">{S.none}</p>
          )}
        </div>
        {current?.signatureDataUrl && !picked ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
            {S.remove}
          </label>
        ) : null}
      </div>

      <Button type="submit" disabled={pending || name.trim() === "" || title.trim() === ""}>
        {S.save}
      </Button>
    </form>
  );
}

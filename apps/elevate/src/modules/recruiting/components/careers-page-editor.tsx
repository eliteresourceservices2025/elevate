"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback-dialog";
import { ImageUp } from "lucide-react";
import { MarkdownField } from "@/components/markdown-field";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useWarnWhenEdited } from "@/components/unsaved-changes";
import { sourceRect } from "@/modules/people/photo";
import { removeCareersBanner, saveCareersPage } from "../actions";
import { DEFAULT_CAREERS_INTRO, DEFAULT_CAREERS_TITLE } from "../constants";
import { useRun } from "./use-run";

const OUT_W = 1600;
const OUT_H = 400;
const ASPECT = OUT_W / OUT_H;
const PREVIEW_W = 640;
const PREVIEW_H = 160;


/** The wording of the public careers page, with the banner picture. Blank fields use the built-in wording. */
export function CareersPageEditor({ initial }: { initial: { title: string; intro: string; bannerVersion: number | null } }) {
  const { run, pending } = useRun();
  const [v, setV] = useState({ title: initial.title, intro: initial.intro });
  const { markSaved } = useWarnWhenEdited(v);

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveCareersPage(v), "Careers page saved.", () => markSaved());
        }}
      >
        <TextField id="cp-title" label="Page title" value={v.title} onChange={(e) => setV((s) => ({ ...s, title: e.target.value }))} maxLength={120} hint={`Leave blank to use: ${DEFAULT_CAREERS_TITLE}`} />
        <MarkdownField
          id="cp-intro"
          label="Introduction"
          value={v.intro}
          onChange={(intro) => setV((s) => ({ ...s, intro }))}
          rows={5}
          maxLength={2000}
          hint={`Shown under the title. Leave blank to use: ${DEFAULT_CAREERS_INTRO} Formatting: **bold**, *italic*, - bullet list, [link text](https://example.com). These are contractor roles: please do not promise salary or benefits.`}
        />
        <Button type="submit" disabled={pending}>
          Save wording
        </Button>
      </form>
      <BannerEditor version={initial.bannerVersion} />
    </div>
  );
}

/** One wide picture at the top of the careers page: choose, move and zoom inside the wide frame, save. */
function BannerEditor({ version }: { version: number | null }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !image) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { sx, sy, sw, sh } = sourceRect(image.naturalWidth, image.naturalHeight, ASPECT, zoom, pos.x, pos.y);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, c.width, c.height);
  }, [image, zoom, pos]);

  const choose = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return void setError("Choose a JPG, PNG or WEBP picture.");
    if (file.size > 20 * 1024 * 1024) return void setError("That picture is too large. Choose one under 20 MB.");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth < 800 || img.naturalWidth / img.naturalHeight < 2) return void setError("Use a wide picture, at least 800 pixels wide and twice as wide as it is tall.");
      setZoom(1);
      setPos({ x: 0, y: 0 });
      setImage(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("We could not open that picture. Try a JPG or PNG.");
    };
    img.src = url;
  };

  const move = (dx: number, dy: number) => {
    if (!image) return;
    const { sw, sh } = sourceRect(image.naturalWidth, image.naturalHeight, ASPECT, zoom, 0, 0);
    const scale = PREVIEW_W / sw;
    const slackX = (image.naturalWidth - sw) / 2;
    const slackY = (image.naturalHeight - sh) / 2;
    setPos((p) => ({
      x: slackX > 0 ? Math.min(1, Math.max(-1, p.x - dx / scale / slackX)) : 0,
      y: slackY > 0 ? Math.min(1, Math.max(-1, p.y - dy / scale / slackY)) : 0,
    }));
  };

  const save = async () => {
    if (!image) return;
    setSaving(true);
    setError(null);
    try {
      const out = document.createElement("canvas");
      out.width = OUT_W;
      out.height = OUT_H;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      const { sx, sy, sw, sh } = sourceRect(image.naturalWidth, image.naturalHeight, ASPECT, zoom, pos.x, pos.y);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("no blob");
      const form = new FormData();
      form.set("banner", blob, "banner.jpg");
      const response = await fetch("/api/careers/banner", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) return void setError(body.error ?? "We could not save the banner. Please try again.");
      toast.success("Banner saved.");
      setImage(null);
      router.refresh();
    } catch {
      setError("We could not save the banner. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Banner" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-semibold">Banner</h2>
        <p className="text-sm text-muted-foreground">One wide picture at the top of the careers page. Use a picture of the team or the work, never a client or a patient.</p>
      </div>

      {image ? (
        <div className="space-y-3">
          <div
            className="relative max-w-full touch-none overflow-hidden rounded-lg border bg-muted"
            style={{ width: PREVIEW_W, height: PREVIEW_H }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              move(e.clientX - drag.current.x, e.clientY - drag.current.y);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            role="img"
            aria-label="Preview of the banner. Drag to move the picture."
          >
            <canvas ref={canvas} width={PREVIEW_W} height={PREVIEW_H} className="size-full cursor-grab active:cursor-grabbing" />
          </div>
          <div className="max-w-xs space-y-1">
            <Label htmlFor="cp-zoom">Zoom</Label>
            <input id="cp-zoom" type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-primary" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save banner"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setImage(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {version ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private image served by our own route
            <img src={`/api/careers/banner?v=${version}`} alt="The current careers page banner" className="aspect-[4/1] w-full max-w-2xl rounded-lg border object-cover" />
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No banner yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => input.current?.click()}>
              <ImageUp aria-hidden /> {version ? "Change banner" : "Add a banner"}
            </Button>
            {version ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => removeCareersBanner(), "Banner removed.")}>
                Remove banner
              </Button>
            ) : null}
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Choose a banner picture"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

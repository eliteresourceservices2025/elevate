"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatInZone } from "@/lib/time";
import { SHOT_REASON_LABELS } from "../labels";
import { viewShot } from "../shot-actions";

type Shot = { id: string; takenAt: string };

const LINK_SECONDS = 55; // the link works for 60 seconds; show "expired" a little before it stops

/**
 * The blurred screenshots of a day, as a row of times. Nothing is loaded until one is opened: opening asks the server for a
 * 60-second link (and, for someone else's screenshot, a reason, which is recorded). Each picture was blurred on the person's computer.
 */
export function ShotGallery({ shots, zone, needReason }: { shots: Shot[]; zone: string; needReason: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("quality_check");
  const [url, setUrl] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!url) return;
    const id = setTimeout(() => setExpired(true), LINK_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [url]);

  const open = shots.find((s) => s.id === openId) ?? null;
  const load = (shotId: string, why: string) => {
    setExpired(false);
    setUrl(null);
    startTransition(async () => {
      const result = await viewShot({ shotId, reason: why });
      if (!result.ok) {
        toast.error(result.error);
        setOpenId(null);
        return;
      }
      setUrl(result.data.url);
    });
  };
  const close = () => {
    setOpenId(null);
    setUrl(null);
    setExpired(false);
  };

  if (shots.length === 0) return <p className="text-sm text-muted-foreground">No screenshots for this day.</p>;

  return (
    <div>
      <ul className="flex flex-wrap gap-2" aria-label="Screenshots">
        {shots.map((s) => (
          <li key={s.id}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpenId(s.id);
                if (!needReason) load(s.id, "quality_check");
              }}
            >
              {formatInZone(s.takenAt, zone, "h:mm a")}
            </Button>
          </li>
        ))}
      </ul>

      <Dialog open={open !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Screenshot{open ? `, ${formatInZone(open.takenAt, zone, "h:mm a")}` : ""}</DialogTitle>
            <DialogDescription>Blurred on the computer before it was sent. The link works for one minute.</DialogDescription>
          </DialogHeader>

          {open && needReason && !url && !pending && !expired ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="shot-reason">Why are you opening this?</Label>
                <NativeSelect id="shot-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {Object.entries(SHOT_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">The reason is recorded with your name. The person can see who looked and why.</p>
              </div>
              <Button onClick={() => load(open.id, reason)}>Open screenshot</Button>
            </div>
          ) : null}

          {pending ? <p role="status" className="text-sm text-muted-foreground">Opening…</p> : null}

          {url && !expired ? (
            // A one-time storage link, not a static asset: next/image cannot optimize it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Blurred screenshot" className="max-h-[70vh] w-full rounded-md border object-contain" />
          ) : null}

          {expired && open ? (
            <div className="space-y-3">
              <p role="status" className="text-sm">Link expired. Open it again to keep looking.</p>
              <Button variant="outline" onClick={() => (needReason ? (setUrl(null), setExpired(false)) : load(open.id, "quality_check"))}>
                Open it again
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

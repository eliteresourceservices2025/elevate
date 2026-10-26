"use client";

import { Download } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDownloadUrl } from "../actions";

export function DownloadButton({ documentId, label }: { documentId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`Download ${label}`}
      onClick={() =>
        startTransition(async () => {
          const result = await getDownloadUrl({ documentId });
          if (!result.ok) return void toast.error(result.error);
          // The link is valid for 60 seconds and saves the file instead of opening it.
          window.location.assign(result.data.url);
        })
      }
    >
      <Download aria-hidden /> Download
    </Button>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { OPEN_PHOTO_EVENT } from "@/components/shell/photo-events";
import { removeProfilePhoto } from "../photo-actions";

/** The big picture at the top of a profile: the photo, or the initials. */
export function ProfilePicture({ initials, photo }: { initials: string; photo: { userId: string; version: number } | null }) {
  return (
    <Avatar className="size-16 text-lg">
      {photo ? <AvatarImage src={`/api/profile-photo/${photo.userId}?v=${photo.version}`} alt="" /> : null}
      <AvatarFallback className="bg-primary text-xl font-semibold text-primary-foreground">{initials}</AvatarFallback>
    </Avatar>
  );
}

/** "Change photo" on your own profile (opens the dialog in the header's account menu). */
export function ChangePhotoButton({ hasPhoto }: { hasPhoto: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PHOTO_EVENT))}>
      <Camera aria-hidden /> {hasPhoto ? "Change photo" : "Add a photo"}
    </Button>
  );
}

/** HR can take down a picture that should not be there. */
export function RemovePhotoButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Remove this person's photo? They can add a new one.")) return;
        startTransition(async () => {
          const result = await removeProfilePhoto({ userId });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Photo removed.");
          router.refresh();
        });
      }}
    >
      Remove photo
    </Button>
  );
}

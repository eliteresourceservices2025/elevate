"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, Camera, Compass, LogOut, ShieldCheck, UserRound } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/lib/initials";
import { signOut } from "@/modules/auth/actions";
import { OPEN_PHOTO_EVENT } from "./photo-events";
import { ProfilePhotoDialog } from "./profile-photo-dialog";
import { START_TOUR_EVENT } from "./tour-events";

/**
 * The person's badge in the header (their initials) and the menu behind it: who they are, the shortcuts that used to crowd the
 * header, the quick tour, and Sign out, which asks first (and says so when the person is still clocked in).
 */
export function AccountMenu({
  name,
  email,
  roles,
  clocked,
  userId,
  photoVersion,
}: {
  name: string | null;
  email: string;
  roles: string[];
  clocked: boolean;
  userId?: string;
  /** When the photo last changed, or null when there is none (the initials show instead). */
  photoVersion?: number | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [choosingPhoto, setChoosingPhoto] = useState(false);

  // "Change photo" on My profile opens the same dialog.
  useEffect(() => {
    const open = () => setChoosingPhoto(true);
    window.addEventListener(OPEN_PHOTO_EVENT, open);
    return () => window.removeEventListener(OPEN_PHOTO_EVENT, open);
  }, []);
  const [pending, startTransition] = useTransition();
  const initials = initialsOf(name, email);
  const item = "flex w-full items-center gap-2";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-tour="account"
          aria-label={`Account menu for ${name ?? email}`}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar size="default">
            {userId && photoVersion ? <AvatarImage src={`/api/profile-photo/${userId}?v=${photoVersion}`} alt="" /> : null}
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">{initials}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="space-y-0.5 py-2">
            <span className="block truncate text-sm font-semibold text-foreground">{name ?? email}</span>
            {name ? <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span> : null}
            {roles.length > 0 ? <span className="block text-xs font-normal text-muted-foreground">{roles.join(", ")}</span> : null}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/people/me" className={item} />}>
            <UserRound aria-hidden /> My profile
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/my-data" className={item} />}>
            <ShieldCheck aria-hidden /> My data
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings/notifications" className={item} />}>
            <Bell aria-hidden /> Email notifications
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChoosingPhoto(true)}>
            <Camera aria-hidden /> {photoVersion ? "Change photo" : "Add a photo"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent(START_TOUR_EVENT))}>
            <Compass aria-hidden /> Quick tour
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <LogOut aria-hidden /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfilePhotoDialog open={choosingPhoto} onOpenChange={setChoosingPhoto} hasPhoto={Boolean(photoVersion)} />

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of ELEVATE?</AlertDialogTitle>
            <AlertDialogDescription>
              {clocked
                ? "You are still clocked in. Signing out does not clock you out, so your time keeps running. Clock out first if your shift is over."
                : "You will need your password or Google, and your authenticator code, to sign in again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay signed in</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => startTransition(() => void signOut())}>
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

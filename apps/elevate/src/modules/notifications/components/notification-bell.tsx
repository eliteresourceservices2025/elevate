"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { loadNotifications, markAllNotificationsRead, markNotificationRead } from "../actions";
import type { NotificationItem } from "../queries";

/** Bell with an unread count. The list loads when it opens; clicking an item marks it read and opens its link. */
export function NotificationBell({ unread: initialUnread }: { unread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      startTransition(async () => {
        const result = await loadNotifications();
        if (result.ok) setItems(result.data.items);
        else toast.error(result.error);
      });
    }
  }

  function openItem(item: NotificationItem) {
    setOpen(false);
    startTransition(async () => {
      if (!item.read) {
        await markNotificationRead({ id: item.id });
        setUnread((n) => Math.max(0, n - 1));
        setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, read: true } : i)) ?? null);
      }
      if (item.link) router.push(item.link);
    });
  }

  function readAll() {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) return void toast.error(result.error);
      setUnread(0);
      setItems((list) => list?.map((i) => ({ ...i, read: true })) ?? null);
    });
  }

  return (
    <div ref={root} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={toggle}
        className="relative"
      >
        <Bell aria-hidden />
        {unread > 0 ? (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div role="region" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 ? (
              <Button type="button" variant="ghost" size="xs" onClick={readAll} disabled={pending}>
                Mark all read
              </Button>
            ) : null}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null ? <li className="px-3 py-4 text-sm text-muted-foreground">Loading…</li> : null}
            {items?.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">You are all caught up.</li> : null}
            {items?.map((n) => (
              <li key={n.id} className="border-b last:border-b-0">
                <button type="button" onClick={() => openItem(n)} className="block w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                  <span className="flex items-start gap-2">
                    {!n.read ? <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /> : <span className="mt-1.5 size-2 shrink-0" aria-hidden />}
                    <span>
                      <span className="block text-sm font-medium">{n.title}</span>
                      {n.body ? <span className="block text-xs text-muted-foreground">{n.body}</span> : null}
                      <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">{formatInZone(n.createdAt, DEFAULT_TIMEZONE, "MMM d, h:mm a")}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { Building2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useAsk } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/time";
import { archiveChatGuest, createClientGroupConversation, inviteChatGuest } from "../actions";
import type { GuestRow, PendingGuestInvite } from "../guests";
import { MAX_TITLE } from "../validators";
import { PeoplePicker, type ChatPerson } from "./people-picker";

type ClientOption = { id: string; name: string };

const selectClass = "h-(--control-h) w-full rounded-lg border border-input bg-background px-3 text-sm";

/** HR and Super Admin: the client guests, who is waiting to accept, and ending a guest's access. */
export function GuestsPanel({ guests, pending, clients, timeZone }: { guests: GuestRow[]; pending: PendingGuestInvite[]; clients: ClientOption[]; timeZone: string }) {
  const router = useRouter();
  const ask = useAsk();
  const [busy, startTransition] = useTransition();

  async function end(guest: GuestRow) {
    if (!(await ask(`End access for ${guest.email}? They leave every chat and can no longer sign in. Their past messages stay.`, { confirmLabel: "End access", destructive: true }))) return;
    startTransition(async () => {
      const result = await archiveChatGuest({ userId: guest.userId });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Access ended.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Guests can only use Messages, and only see the chats they are added to.</p>
        <div className="flex flex-wrap gap-2">
          <InviteGuestDialog clients={clients} onDone={() => router.refresh()} />
        </div>
      </div>
      <Alert variant="warning">
        <AlertDescription>Client chats are for attendance matters only. The guest notice tells guests never to share patient details, and every client chat shows the same reminder.</AlertDescription>
      </Alert>

      {guests.length === 0 && pending.length === 0 ? (
        <EmptyState icon={Building2} title="No client guests yet" description="Invite a client contact to chat with your team about attendance." />
      ) : null}

      {guests.length > 0 ? (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Guest</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Notice accepted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guests.map((g) => (
              <TableRow key={g.userId}>
                <TableCell className="font-medium">{g.email}</TableCell>
                <TableCell label="Client">{g.clientName}</TableCell>
                <TableCell label="Notice accepted">{g.noticeAcceptedAt ? formatInZone(g.noticeAcceptedAt, timeZone, "MMM d, yyyy") : "Not yet"}</TableCell>
                <TableCell label="Status">{g.archivedAt ? "Access ended" : "Active"}</TableCell>
                <TableCell className="text-right">
                  {g.archivedAt ? null : (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void end(g)}>
                      End access
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {pending.length > 0 ? (
        <section aria-label="Waiting invitations" className="flex flex-col gap-2">
          <h2 className="font-heading text-base font-semibold">Waiting to sign in</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {pending.map((p) => (
              <li key={p.invitationId} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <span className="font-medium">{p.email}</span>
                <span className="text-muted-foreground">{p.clientName}</span>
                <span className="ml-auto text-xs text-muted-foreground">Invitation ends {formatInZone(p.expiresAt, timeZone, "MMM d, yyyy")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function InviteGuestDialog({ clients, onDone }: { clients: ClientOption[]; onDone: () => void }) {
  return (
    <FormDialog label="Invite a guest" title="Invite a client guest" description="They get an email, sign in with a code from an authenticator app, and see only the chats you add them to." size="md" icon={<UserPlus aria-hidden />}>
      <InviteGuestForm clients={clients} onDone={onDone} />
    </FormDialog>
  );
}

function InviteGuestForm({ clients, onDone }: { clients: ClientOption[]; onDone: () => void }) {
  const dialog = useFormDialog();
  const [email, setEmail] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await inviteChatGuest({ email, clientId });
          if (!result.ok) return void toast.error(result.error);
          toast.success(result.data.emailed ? "Invitation sent." : "Invitation saved. No email service is set up here, so tell them to sign up with this address.");
          await dialog?.close(true);
          onDone();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="guest-email" className="text-sm font-medium">
          Their work email
        </label>
        <Input id="guest-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="guest-client" className="text-sm font-medium">
          Client
        </label>
        <select id="guest-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={selectClass} required>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !email || !clientId}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}

/** "New client group" (HR Admin and Super Admin): a chat for one client's guests and the staff you pick. */
export function ClientGroupDialog({ clients, guests, onOpened }: { clients: ClientOption[]; guests: GuestRow[]; onOpened: (conversationId: string) => void }) {
  return (
    <FormDialog label="New client group" title="New client group" description="A chat for one client's guests and your team. It always shows the attendance-only reminder." size="md" variant="outline" icon={<Building2 aria-hidden />}>
      <ClientGroupForm clients={clients} guests={guests} onOpened={onOpened} />
    </FormDialog>
  );
}

function ClientGroupForm({ clients, guests, onOpened }: { clients: ClientOption[]; guests: GuestRow[]; onOpened: (conversationId: string) => void }) {
  const dialog = useFormDialog();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [guestIds, setGuestIds] = useState<string[]>([]);
  const [staff, setStaff] = useState<ChatPerson[]>([]);
  const [pending, startTransition] = useTransition();
  const options = guests.filter((g) => g.clientId === clientId && !g.archivedAt);
  const total = guestIds.length + staff.length;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createClientGroupConversation({ clientId, title, guestUserIds: guestIds, staffUserIds: staff.map((p) => p.userId) });
          if (!result.ok) return void toast.error(result.error);
          await dialog?.close(true);
          onOpened(result.data.conversationId);
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cg-client" className="text-sm font-medium">
          Client
        </label>
        <select
          id="cg-client"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setGuestIds([]);
          }}
          className={selectClass}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cg-title" className="text-sm font-medium">
          Group name
        </label>
        <Input id="cg-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE} placeholder="For example, Riverside Clinic attendance" />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Client guests</legend>
        {options.length === 0 ? <p className="text-sm text-muted-foreground">No guests for this client yet. Invite one first.</p> : null}
        {options.map((g) => (
          <label key={g.userId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={guestIds.includes(g.userId)} onChange={(e) => setGuestIds((c) => (e.target.checked ? [...c, g.userId] : c.filter((id) => id !== g.userId)))} />
            {g.email}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Your team</p>
        <PeoplePicker
          selected={staff}
          onToggle={(p) => setStaff((c) => (c.some((x) => x.userId === p.userId) ? c.filter((x) => x.userId !== p.userId) : [...c, p]))}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !title.trim() || !clientId || total < 1}>
          Create group
        </Button>
      </div>
    </form>
  );
}

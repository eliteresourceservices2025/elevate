"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BASE_ROLE, ROLE_SLUGS, roleLabel, type RoleSlug } from "@/lib/roles";
import { deactivateAccount, reactivateAccount, resetAuthenticator, setSafevoiceHandler, setUserRoles } from "../actions";
import type { PersonRow } from "../queries";

const ASSIGNABLE = ROLE_SLUGS.filter((r) => r !== BASE_ROLE);

function EditRolesDialog({ person }: { person: PersonRow }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<RoleSlug>>(new Set(person.roles));
  const [pending, startTransition] = useTransition();

  function toggle(role: RoleSlug, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(role);
      else next.delete(role);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setUserRoles({ userId: person.id, roles: [...selected] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Roles updated for ${person.email}. They were signed out.`);
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSelected(new Set(person.roles));
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit roles</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles for {person.email}</DialogTitle>
          <DialogDescription>
            Everyone keeps the Employee role. Saving signs this person out so the change applies right away.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {ASSIGNABLE.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <Checkbox
                id={`${person.id}-${role}`}
                checked={selected.has(role)}
                onCheckedChange={(checked) => toggle(role, checked === true)}
              />
              <Label htmlFor={`${person.id}-${role}`}>{roleLabel(role)}</Label>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetAuthenticatorButton({ person }: { person: PersonRow }) {
  const [pending, startTransition] = useTransition();

  function reset() {
    startTransition(async () => {
      const result = await resetAuthenticator({ userId: person.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Authenticator reset for ${person.email}. They set up a new one at next sign-in.`);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
        Reset authenticator
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset authenticator for {person.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only do this after confirming it is really them, for example on a call. Their current authenticator is
            removed and they are signed out. At next sign-in they scan a new QR code.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={reset}>Reset</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeactivateButton({ person }: { person: PersonRow }) {
  const [pending, startTransition] = useTransition();

  function run(kind: "deactivate" | "reactivate") {
    startTransition(async () => {
      const result = kind === "deactivate" ? await deactivateAccount({ userId: person.id }) : await reactivateAccount({ userId: person.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(kind === "deactivate" ? `${person.email} was deactivated.` : `${person.email} can sign in again.`);
    });
  }

  if (person.archived) {
    return (
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run("reactivate")}>
        Reactivate
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>Deactivate</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {person.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            They are signed out and cannot sign in again until you reactivate the account. Nothing is deleted. This is for test accounts and mistakes.
            Someone who works on the team is ended through Offboarding instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => run("deactivate")}>Deactivate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function HandlerToggle({ person }: { person: PersonRow }) {
  const [pending, startTransition] = useTransition();

  function toggle(enabled: boolean) {
    startTransition(async () => {
      const result = await setSafevoiceHandler({ userId: person.id, enabled });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={`${person.id}-handler`}
        checked={person.isSafevoiceHandler}
        disabled={pending}
        onCheckedChange={(checked) => toggle(checked === true)}
      />
      <Label htmlFor={`${person.id}-handler`} className="sr-only">
        Safe Voice handler for {person.email}
      </Label>
    </div>
  );
}

export function RolesTable({ people, currentUserId }: { people: PersonRow[]; currentUserId: string }) {
  const [filter, setFilter] = useState("");
  const shown = people.filter((p) => p.email.toLowerCase().includes(filter.trim().toLowerCase()));
  const paged = usePaged(shown, filter);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="roles-filter" className="text-xs">
          Find a person by email
        </Label>
        <Input id="roles-filter" className="h-8 w-64" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
    <Table containerClassName="[--shadow-cover:var(--background)]">
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Roles</TableHead>
          <TableHead>Safe Voice handler</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {paged.rows.map((person) => {
          const isSelf = person.id === currentUserId;
          return (
            <TableRow key={person.id}>
              <TableCell className="font-medium">
                {person.email}
                {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                {person.archived ? <Badge variant="outline" className="ml-2">Archived</Badge> : null}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {person.roles.map((r) => (
                    <Badge key={r} variant={r === "employee" ? "outline" : "secondary"}>
                      {roleLabel(r)}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>{isSelf ? <span className="text-xs text-muted-foreground">—</span> : <HandlerToggle person={person} />}</TableCell>
              <TableCell className="text-right">
                {isSelf ? (
                  <span className="text-xs text-muted-foreground">You cannot change your own access.</span>
                ) : (
                  <div className="flex justify-end gap-1">
                    {person.archived ? null : <EditRolesDialog person={person} />}
                    {person.archived ? null : <ResetAuthenticatorButton person={person} />}
                    <DeactivateButton person={person} />
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
      <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="people" />
    </div>
  );
}

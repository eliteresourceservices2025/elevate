"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { GRANTABLE_ROLES, roleLabel } from "@/lib/roles";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { Field } from "@/modules/auth/components/field";
import { createInvitation, revokeInvitation } from "../actions";
import type { InvitationRow } from "../queries";
import { createInvitationSchema, type CreateInvitationInput } from "../validators";

function status(row: InvitationRow, now: number) {
  if (row.acceptedAt) return { label: "Accepted", variant: "secondary" as const };
  if (row.expiresAt.getTime() < now) return { label: "Expired", variant: "outline" as const };
  return { label: "Pending", variant: "default" as const };
}

function RevokeButton({ row }: { row: InvitationRow }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revokeInvitation({ invitationId: row.id });
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      Revoke
    </Button>
  );
}

export function InvitationsPanel({ invitations, now, canAssign }: { invitations: InvitationRow[]; now: number; canAssign: boolean }) {
  // What a Super Admin picks for the next invitation; it is applied when the person first signs in.
  const [roles, setRoles] = useState<string[]>([]);
  const [handler, setHandler] = useState(false);
  const paged = usePaged(invitations, "", 10);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvitationInput>({ resolver: zodResolver(createInvitationSchema) });

  async function onSubmit(values: CreateInvitationInput) {
    const result = await createInvitation({ ...values, roles: canAssign ? roles : [], safevoiceHandler: canAssign && handler });
    if (!result.ok) return toast.error(result.error);
    if (result.data.emailed) toast.success(`Invited ${values.email}. We emailed them the link.`);
    else toast.success(`Invited ${values.email}, but no email was sent (email is not set up here, or it failed). Ask them to use "Accept an invite" on the sign-in page.`);
    reset();
    setRoles([]);
    setHandler(false);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-4" noValidate>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <Field id="invite-email" label="Invite by email" type="email" autoComplete="off" error={errors.email?.message} {...register("email")} />
          </div>
          <Button type="submit" className="mt-[1.375rem]" disabled={isSubmitting}>
            Invite
          </Button>
        </div>
        {canAssign ? (
          <fieldset className="space-y-2 rounded-xl border p-3">
            <legend className="px-1 text-sm font-medium">Give them, on top of Employee</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {GRANTABLE_ROLES.map((role) => (
                <div key={role} className="flex items-center gap-2">
                  <Checkbox
                    id={`invite-role-${role}`}
                    checked={roles.includes(role)}
                    onCheckedChange={(checked) => setRoles((prev) => (checked === true ? [...new Set([...prev, role])] : prev.filter((r) => r !== role)))}
                  />
                  <Label htmlFor={`invite-role-${role}`}>{roleLabel(role)}</Label>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t pt-2">
              <Checkbox id="invite-handler" checked={handler} onCheckedChange={(checked) => setHandler(checked === true)} />
              <Label htmlFor="invite-handler">Safe Voice handler (can read and answer anonymous reports)</Label>
            </div>
            <p className="text-xs text-muted-foreground">Applied once, when they first sign in. Nothing is granted before that, and an invitation that runs out grants nothing.</p>
          </fieldset>
        ) : null}
      </form>
      <p className="text-sm text-muted-foreground">
        Invitations last 7 days. New people start as Employee; only a Super Admin can give other roles or make someone a Safe Voice handler. We email the link when
        email is set up. If they do not receive it, tell them to use <strong>Accept an invite</strong> on the sign-in page with this exact
        address.
      </p>
      <Table containerClassName="[--shadow-cover:var(--background)]">
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Invited by</TableHead>
            {canAssign ? <TableHead>Gets on sign-in</TableHead> : null}
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canAssign ? 6 : 5} className="text-center text-muted-foreground">
                No invitations yet.
              </TableCell>
            </TableRow>
          ) : null}
          {paged.rows.map((row) => {
            const s = status(row, now);
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.email}</TableCell>
                <TableCell>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </TableCell>
                <TableCell>{row.invitedByEmail ?? "—"}</TableCell>
                {canAssign ? (
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.roles.map((r) => (
                        <Badge key={r} variant="outline">
                          {roleLabel(r as never)}
                        </Badge>
                      ))}
                      {row.isSafevoiceHandler ? <Badge variant="outline">Safe Voice handler</Badge> : null}
                      {row.roles.length === 0 && !row.isSafevoiceHandler ? <span className="text-muted-foreground">Employee only</span> : null}
                    </div>
                  </TableCell>
                ) : null}
                <TableCell>{formatInZone(row.expiresAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}</TableCell>
                <TableCell className="text-right">{row.acceptedAt ? null : <RevokeButton row={row} />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="invitations" />
    </div>
  );
}

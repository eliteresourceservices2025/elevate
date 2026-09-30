"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function InvitationsPanel({ invitations, now }: { invitations: InvitationRow[]; now: number }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvitationInput>({ resolver: zodResolver(createInvitationSchema) });

  async function onSubmit(values: CreateInvitationInput) {
    const result = await createInvitation(values);
    if (!result.ok) return toast.error(result.error);
    toast.success(`Invited ${values.email}. Ask them to use "Accept an invite" on the sign-in page.`);
    reset();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-xl items-start gap-3" noValidate>
        <div className="flex-1">
          <Field id="invite-email" label="Invite by email" type="email" autoComplete="off" error={errors.email?.message} {...register("email")} />
        </div>
        <Button type="submit" className="mt-[1.375rem]" disabled={isSubmitting}>
          Invite
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Invitations last 7 days. New people start as Employee; only a Super Admin can give other roles. Email delivery
        comes later, so tell the person to use <strong>Accept an invite</strong> on the sign-in page with this exact
        address.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Invited by</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No invitations yet.
              </TableCell>
            </TableRow>
          ) : null}
          {invitations.map((row) => {
            const s = status(row, now);
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.email}</TableCell>
                <TableCell>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </TableCell>
                <TableCell>{row.invitedByEmail ?? "—"}</TableCell>
                <TableCell>{formatInZone(row.expiresAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}</TableCell>
                <TableCell className="text-right">{row.acceptedAt ? null : <RevokeButton row={row} />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

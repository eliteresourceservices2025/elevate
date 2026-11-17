"use client";

import { Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { toast } from "@/components/feedback-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInZone } from "@/lib/time";
import { loadGroupPeopleToManage, syncChatChannels } from "../actions";
import type { GuestRow } from "../guests";
import type { ManagedGroup } from "../queries";
import { ClientGroupDialog } from "./guest-admin";
import { RenameGroupDialog, useDeleteGroup, useRemovePerson } from "./group-admin";
import { AddPeopleDialog, NewGroupDialog } from "./new-conversation-dialog";

type Person = { userId: string; name: string };

/**
 * Every group, for HR Admins and Super Admins: create, rename, add and remove people, delete. It shows names and counts only;
 * it never shows what was said, and managing a group does not make you a member of it.
 */
export function ManageGroups({ groups, timeZone, clients, guests }: { groups: ManagedGroup[]; timeZone: string; clients: { id: string; name: string }[]; guests: GuestRow[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [syncing, setSyncing] = useState(false);

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  async function select(id: string) {
    setSelectedId(id);
    setPeople(null);
    await reloadPeople(id);
  }

  async function reloadPeople(id: string) {
    try {
      const result = await loadGroupPeopleToManage({ conversationId: id });
      if (!result.ok) {
        toast.error(result.error);
        setSelectedId(null);
        router.refresh();
        return;
      }
      setPeople(result.data);
    } catch {
      toast.error("Could not reach ELEVATE. Check your connection and try again.");
    }
  }

  async function syncChannels() {
    setSyncing(true);
    try {
      const result = await syncChatChannels();
      if (!result.ok) return void toast.error(result.error);
      if (result.data.skipped) return void toast.error(result.data.skipped);
      toast.success(`Channels updated: ${result.data.created} new, ${result.data.membersAdded} people added, ${result.data.membersRemoved} removed.`);
    } catch {
      toast.error("Could not reach ELEVATE. Check your connection and try again.");
    } finally {
      setSyncing(false);
    }
  }

  const removePerson = useRemovePerson(() => {
    if (selectedId) void reloadPeople(selectedId);
    router.refresh();
  });
  const deleteGroup = useDeleteGroup(() => {
    setSelectedId(null);
    setPeople(null);
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{groups.length} {groups.length === 1 ? "group" : "groups"}. Groups hold up to 200 people. Team, department and company channels are automatic and follow the organization.</p>
        <Button type="button" variant="outline" onClick={() => void syncChannels()} disabled={syncing}>
          {syncing ? "Updating…" : "Update channels now"}
        </Button>
        {clients.length > 0 ? (
          <ClientGroupDialog
            clients={clients}
            guests={guests}
            onOpened={(id) => {
              router.refresh();
              void select(id);
            }}
          />
        ) : null}
        <NewGroupDialog
          onOpened={(id) => {
            router.refresh();
            void select(id);
          }}
        />
      </div>

      <Alert variant="info">
        <AlertDescription>You see names and counts here, never what people wrote. Managing a group does not put you in it. To read a chat, ask for an access request (coming soon).</AlertDescription>
      </Alert>

      {groups.length === 0 ? (
        <EmptyState icon={Users} title="No groups yet" description="Make a group to chat with a team, a client crew or the whole company." />
      ) : (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead>People</TableHead>
              <TableHead>Made by</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <TableRow key={g.id} data-state={g.id === selectedId ? "selected" : undefined}>
                <TableCell className="font-medium">
                  {g.title}
                  {g.kind === "client" ? <span className="ml-2 rounded bg-info-surface px-1.5 py-0.5 text-xs font-medium">Client: {g.clientName}</span> : null}
                  {g.amMember ? <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">You&apos;re in it</span> : null}
                </TableCell>
                <TableCell label="People">{g.memberCount}</TableCell>
                <TableCell label="Made by">{g.createdByName}</TableCell>
                <TableCell label="Created">{formatInZone(g.createdAt, timeZone, "MMM d, yyyy")}</TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="outline" size="sm" onClick={() => void select(g.id)} aria-pressed={g.id === selectedId}>
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected ? (
        <section aria-label={`Manage ${selected.title}`} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-heading text-lg font-semibold">{selected.title}</h2>
            <RenameGroupDialog
              conversationId={selected.id}
              current={selected.title}
              onDone={() => {
                router.refresh();
                void reloadPeople(selected.id);
              }}
            />
            <AddPeopleDialog
              conversationId={selected.id}
              disabled={people === null}
              existing={(people ?? []).map((p) => p.userId)}
              onAdded={() => {
                router.refresh();
                void reloadPeople(selected.id);
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void deleteGroup(selected.id, selected.title)}>
              Delete group
            </Button>
          </div>
          {people ? (
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3" aria-label={`People in ${selected.title}`}>
              {people.map((p) => (
                <li key={p.userId} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => void removePerson(selected.id, p)} aria-label={`Remove ${p.name}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              Loading people…
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

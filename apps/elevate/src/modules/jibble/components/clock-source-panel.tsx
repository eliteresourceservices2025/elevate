"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/feedback-dialog";
import { SelectField, TextField } from "@/components/form-fields";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormDialog } from "@/components/form-dialog";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { importJibbleHours, removeClientMap, saveClientMap, setClockSource, setJibbleClockForMany } from "../clock-source-actions";
import type { ClockSourceOverview } from "../clock-source-queries";
import { CloseSessionForm } from "./close-session-form";

const KIND_TEXT = { project: "Project", activity: "Activity" } as const;

/** Runs a server action from a button: toast the error or the success, then refresh the page. */
function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    start(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        toast.success(success);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return { act, pending };
}

/** One person's row: where their hours come from, a button to change it, and (for Jibble) a button to import the last days now. */
function PersonRow({ person }: { person: ClockSourceOverview["people"][number] }) {
  const { act, pending } = useAct();
  const [days, setDays] = useState("3");
  const fromJibble = person.source === "jibble";
  return (
    <TableRow>
      <TableCell className="font-medium">
        {person.name}
        <span className="block text-xs font-normal text-muted-foreground">{person.team ?? "No team"}</span>
      </TableCell>
      <TableCell label="Clock">
        <Badge variant={fromJibble ? "info" : "outline"}>{fromJibble ? "Jibble clock" : "ELEVATE clock"}</Badge>
        {person.open ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            Clocked in{person.open.onBreak ? " (on a break)" : ""} since {formatInZone(person.open.since, person.open.zone, "EEE MMM d, h:mm a")}
          </span>
        ) : null}
      </TableCell>
      <TableCell label="Action">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={fromJibble ? "outline" : "default"}
            disabled={pending}
            onClick={() => act(() => setClockSource({ employeeId: person.employeeId, source: fromJibble ? "elevate" : "jibble" }), fromJibble ? "They use the ELEVATE clock again." : "Their hours now come from Jibble.")}
          >
            {fromJibble ? "Use the ELEVATE clock" : "Use the Jibble clock"}
          </Button>
          {fromJibble && person.open ? (
            <FormDialog label="Close session and switch" title={`Close ${person.name}'s open session`} description="Ends the session Jibble left open, then moves them to the ELEVATE clock." variant="outline" triggerSize="sm">
              <CloseSessionForm employeeId={person.employeeId} name={person.name} open={person.open} />
            </FormDialog>
          ) : null}
          {fromJibble ? (
            <span className="flex items-center gap-1">
              <label className="sr-only" htmlFor={`imp-${person.employeeId}`}>
                Days to import for {person.name}
              </label>
              <select id={`imp-${person.employeeId}`} value={days} onChange={(e) => setDays(e.target.value)} className="h-(--control-h-sm) rounded-md border bg-background px-2 text-sm">
                {[1, 3, 7, 14].map((d) => (
                  <option key={d} value={d}>
                    Last {d} {d === 1 ? "day" : "days"}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => act(() => importJibbleHours({ employeeId: person.employeeId, days }), "Imported from Jibble. Their days are rebuilt.")}
              >
                Import now
              </Button>
            </span>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** A Jibble id with no client yet: pick the client and save. */
function UnmappedRow({ item, clients }: { item: ClockSourceOverview["unmapped"][number]; clients: ClockSourceOverview["clients"] }) {
  const { act, pending } = useAct();
  const [clientId, setClientId] = useState("");
  return (
    <li className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium">
          {KIND_TEXT[item.kind]} <code className="font-mono text-xs">{item.jibbleId}</code>
        </p>
        <p className="text-xs text-muted-foreground">
          Last seen {formatDateOnly(item.lastSeenAt.slice(0, 10))}
          {item.example ? `, for example on ${item.example}'s time` : ""}
        </p>
      </div>
      <SelectField id={`um-${item.kind}-${item.jibbleId}`} label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
        <option value="">Choose a client</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <Button type="button" size="sm" disabled={pending || !clientId} onClick={() => act(() => saveClientMap({ kind: item.kind, jibbleId: item.jibbleId, clientId }), "Saved. It applies at the next import (within 30 minutes).")}>
        Save
      </Button>
    </li>
  );
}

/**
 * Contractors who have not used the ELEVATE clock for 14 days and are clocked out: the likely "Jibble alone" people. HR ticks who moves to
 * the Jibble clock (all ticked by default) and confirms; their last 14 days are then imported, and the 30-minute job keeps them current.
 */
function JibbleAloneCard({ people }: { people: ClockSourceOverview["jibbleAlone"] }) {
  const confirm = useConfirm();
  const { act, pending } = useAct();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.map((p) => p.employeeId)));
  const [outcome, setOutcome] = useState<{ switched: number; already: number; skipped: { name: string; reason: string }[] } | null>(null);
  const paged = usePaged(people, "alone");
  if (people.length === 0 && !outcome) return null;
  const allPicked = people.length > 0 && people.every((p) => picked.has(p.employeeId));
  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const move = async () => {
    const proceed = await confirm({
      title: `Move ${picked.size} ${picked.size === 1 ? "person" : "people"} to the Jibble clock?`,
      description: "Their ELEVATE clock is switched off and each person is told. Their last 14 days are read from Jibble now (it can take a minute), and every 30 minutes after that. You can switch anyone back.",
      confirmLabel: "Move to the Jibble clock",
      cancelLabel: "Cancel",
    });
    if (!proceed) return;
    let result: typeof outcome = null;
    act(
      async () => {
        const r = await setJibbleClockForMany({ employeeIds: [...picked] });
        if (r.ok) result = r.data;
        return r;
      },
      "Moved to the Jibble clock. Their hours are being imported.",
      () => setOutcome(result),
    );
  };
  return (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold">People who seem to use Jibble alone ({people.length})</h3>
        <p className="text-xs text-muted-foreground">
          Matched to a Jibble account, not clocked in, and no ELEVATE clock use in the last 14 days. Move them to the Jibble clock and their hours fill in from Jibble.
        </p>
      </div>
      {outcome ? (
        <Alert variant={outcome.skipped.length > 0 ? "warning" : "success"}>
          Moved {outcome.switched} {outcome.switched === 1 ? "person" : "people"}
          {outcome.already > 0 ? `, ${outcome.already} were already on the Jibble clock` : ""}.
          {outcome.skipped.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {outcome.skipped.map((k) => (
                <li key={k.name}>
                  {k.name}: {k.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {people.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setPicked(allPicked ? new Set() : new Set(people.map((p) => p.employeeId)))}>
              {allPicked ? "Untick all" : "Tick all"}
            </Button>
            <Button type="button" size="sm" disabled={pending || picked.size === 0} onClick={() => void move()}>
              Move {picked.size} to the Jibble clock
            </Button>
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {paged.rows.map((p) => (
              <li key={p.employeeId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <label className="flex flex-1 items-center gap-3">
                  <input type="checkbox" className="size-4 accent-primary" checked={picked.has(p.employeeId)} onChange={() => toggle(p.employeeId)} aria-label={`Move ${p.name} to the Jibble clock`} />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.team ?? "No team"}</span>
                </label>
                <span className="text-xs text-muted-foreground">{p.lastElevate ? `Last ELEVATE clock: ${formatDateOnly(p.lastElevate.slice(0, 10))}` : "Never used the ELEVATE clock"}</span>
              </li>
            ))}
          </ul>
          <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="people" />
        </>
      ) : null}
    </div>
  );
}

/** HR: who clocks in Jibble, and which Jibble projects and activities mean which client. */
export function ClockSourcePanel({ overview }: { overview: ClockSourceOverview }) {
  const { act, pending } = useAct();
  const [find, setFind] = useState("");
  const [kind, setKind] = useState<"project" | "activity">("project");
  const [jibbleId, setJibbleId] = useState("");
  const [clientId, setClientId] = useState("");
  const shown = overview.people.filter((p) => find.trim() === "" || p.name.toLowerCase().includes(find.trim().toLowerCase()));
  const paged = usePaged(shown, find);
  const jibbleCount = overview.people.filter((p) => p.source === "jibble").length;
  return (
    <section aria-label="Hours from Jibble" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Hours from Jibble</h2>
        <p className="text-sm text-muted-foreground">
          A person on the <strong>Jibble clock</strong> clocks in and out in Jibble. Every 30 minutes ELEVATE reads their time entries (the time, and the project and activity) and turns them into clock events, so hours review, approval and the payroll export work the same for them. They cannot use the ELEVATE clock. Screenshots stay in Jibble.
        </p>
      </div>
      <Alert variant="info">
        {jibbleCount} of {overview.people.length} matched {overview.people.length === 1 ? "person" : "people"} use the Jibble clock. Change someone only when they are clocked out. If an entry is edited or deleted in Jibble, ELEVATE follows it; their hours there are always the source.
      </Alert>

      <JibbleAloneCard people={overview.jibbleAlone} />

      <div className="space-y-2">
        <TextField id="cs-find" label="Find a person" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Start typing a name" />
        {overview.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is matched to a Jibble account yet. Match people above first.</p>
        ) : (
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Clock</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.rows.map((p) => (
                  <PersonRow key={p.employeeId} person={p} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {overview.people.length > 0 ? <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="people" /> : null}
      </div>

      <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <div>
          <h3 className="text-sm font-semibold">Jibble projects and activities → clients</h3>
          <p className="text-xs text-muted-foreground">
            For people on the Jibble clock who work for more than one client: say which client each Jibble project or activity means. An activity wins over a project. A person with one client needs no mapping. Time with no client is flagged &quot;Choose the client&quot; and blocks approval until mapped.
          </p>
        </div>
        {overview.unmapped.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Seen on entries, with no client yet</p>
            <ul className="space-y-2">
              {overview.unmapped.map((u) => (
                <UnmappedRow key={`${u.kind}|${u.jibbleId}`} item={u} clients={overview.clients} />
              ))}
            </ul>
          </div>
        ) : null}
        {overview.maps.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {overview.maps.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {KIND_TEXT[m.kind]} <code className="font-mono text-xs">{m.jibbleId}</code> → <span className="font-medium">{m.clientName}</span>
                </span>
                <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => act(() => removeClientMap({ id: m.id }), "Mapping removed.")}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No mappings yet.</p>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => saveClientMap({ kind, jibbleId, clientId }), "Saved. It applies at the next import (within 30 minutes).", () => setJibbleId(""));
          }}
        >
          <SelectField id="cm-kind" label="Kind" value={kind} onChange={(e) => setKind(e.target.value as "project" | "activity")}>
            <option value="project">Project</option>
            <option value="activity">Activity</option>
          </SelectField>
          <TextField id="cm-id" label="Jibble id" value={jibbleId} onChange={(e) => setJibbleId(e.target.value)} placeholder="Paste the id from Jibble" required />
          <SelectField id="cm-client" label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Choose a client</option>
            {overview.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit" disabled={pending || !jibbleId.trim() || !clientId}>
            Add mapping
          </Button>
        </form>
      </div>
    </section>
  );
}

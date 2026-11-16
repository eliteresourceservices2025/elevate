"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { toast } from "@/components/feedback-dialog";
import { SelectField, TextField } from "@/components/form-fields";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/time";
import { importJibbleHours, removeClientMap, saveClientMap, setClockSource } from "../clock-source-actions";
import type { ClockSourceOverview } from "../clock-source-queries";

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

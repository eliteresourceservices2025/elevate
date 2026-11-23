"use client";

import { Building2, ChevronDown, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAsk } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { SelectField, TextField } from "@/components/form-fields";
import { StatusChip } from "@/components/status-chip";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { archiveClientProject, createClientProject, renameClientProject, setClientNoProjectAllowed, setClientProjectPeople, updateClient } from "../actions";
import { PhiToggle, useRun } from "./admin-forms";

export type ClientItem = { id: string; name: string; timeZone: string; holidayCalendar: "PH" | "US"; isActive: boolean; handlesPhi: boolean; allowNoProject: boolean };
export type ProjectItem = { id: string; clientId: string; name: string };
type Person = { id: string; name: string };
type Filter = "all" | "projects" | "inactive";

/** "America/New_York" -> "New York": the region is noise in a list. */
const shortZone = (zone: string) => (zone.split("/").pop() ?? zone).replaceAll("_", " ");

/**
 * The Clients page list: search and filter, one collapsed row per client (name, a few chips, how many projects), and a panel that opens
 * under a client with its projects (who can pick each) and its details. Everything is a server action; this only holds what is open.
 */
export function ClientsBoard({
  clients,
  projects,
  clientPeople,
  members,
  timeZones,
}: {
  clients: ClientItem[];
  projects: ProjectItem[];
  clientPeople: Record<string, Person[]>;
  members: Record<string, string[]>;
  timeZones: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const projectsOf = (clientId: string) => projects.filter((p) => p.clientId === clientId);
  const counts = useMemo(
    () => ({ all: clients.length, projects: clients.filter((c) => projects.some((p) => p.clientId === c.id)).length, inactive: clients.filter((c) => !c.isActive).length }),
    [clients, projects],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (filter === "projects") return projects.some((p) => p.clientId === c.id);
      if (filter === "inactive") return !c.isActive;
      return true;
    });
  }, [clients, projects, query, filter]);

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: `All ${counts.all}` },
    { key: "projects", label: `With projects ${counts.projects}` },
    { key: "inactive", label: `Inactive ${counts.inactive}` },
  ];

  return (
    <section className="space-y-3" aria-label="Clients">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[min(100%,16rem)] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients" aria-label="Search clients" className="pl-8" />
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "secondary" : "ghost"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </Button>
          ))}
        </div>
        {clients.length > 1 ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(open.size > 0 ? new Set() : new Set(shown.map((c) => c.id)))}>
            {open.size > 0 ? "Collapse all" : "Expand all"}
          </Button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Building2} title={clients.length === 0 ? "No clients yet" : "No clients match"} description={clients.length === 0 ? "Add the first client with the Add client button." : "Try another name or filter."} />
      ) : (
        <ul className="space-y-2">
          {shown.map((c) => {
            const mine = projectsOf(c.id);
            const isOpen = open.has(c.id);
            return (
              <li key={c.id} className={cn("overflow-hidden rounded-xl border bg-card", !c.isActive && "bg-muted/40")}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`client-panel-${c.id}`}
                  onClick={() => toggle(c.id)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 basis-48 truncate font-medium">{c.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusChip tone="neutral">{shortZone(c.timeZone)}</StatusChip>
                    <StatusChip tone="neutral">{c.holidayCalendar === "PH" ? "PH" : "US"} holidays</StatusChip>
                    {c.handlesPhi ? <StatusChip tone="info">Patient info</StatusChip> : null}
                    {c.isActive ? null : <StatusChip tone="warning">Inactive</StatusChip>}
                  </span>
                  <span className="w-24 text-right text-sm text-muted-foreground">{mine.length === 0 ? "No projects" : `${mine.length} ${mine.length === 1 ? "project" : "projects"}`}</span>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
                </button>
                {isOpen ? (
                  <div id={`client-panel-${c.id}`} className="grid gap-6 border-t px-4 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <ProjectsPanel client={c} projects={mine} people={clientPeople[c.id] ?? []} members={members} />
                    <DetailsPanel client={c} timeZones={timeZones} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A client's projects: each with who can pick it, plus a one-line way to add another. */
function ProjectsPanel({ client, projects, people, members }: { client: ClientItem; projects: ProjectItem[]; people: Person[]; members: Record<string, string[]> }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingPeople, setEditingPeople] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone who left";

  const who = (projectId: string) => {
    const ids = members[projectId] ?? [];
    if (ids.length === 0) return "Open to everyone assigned to this client";
    const names = ids.map(nameOf);
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  };

  return (
    <div aria-label={`Projects of ${client.name}`} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Projects</h3>
        <p className="text-xs text-muted-foreground">People who work for this client pick one on the clock. Choose who can pick each, or leave it open to everyone on the client.</p>
      </div>

      {projects.length === 0 ? <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">No projects yet. People just pick the client.</p> : null}
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="rounded-lg border bg-background px-3 py-2">
            {renaming === p.id ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => renameClientProject({ projectId: p.id, name: newName }), "Project renamed.", () => setRenaming(null));
                }}
              >
                <TextField id={`rp-${p.id}`} label="Project name" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                <Button type="submit" size="sm" disabled={pending || !newName.trim()}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{who(p.id)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={editingPeople === p.id}
                    onClick={() => {
                      setPicked(members[p.id] ?? []);
                      setEditingPeople(editingPeople === p.id ? null : p.id);
                    }}
                  >
                    Who can pick it
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setNewName(p.name);
                      setRenaming(p.id);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={async () => {
                      if (await ask(`Archive the project "${p.name}"? People can no longer pick it. Time already recorded keeps its name.`, { confirmLabel: "Archive project", destructive: false })) {
                        run(() => archiveClientProject({ projectId: p.id }), "Project archived.");
                      }
                    }}
                  >
                    Archive
                  </Button>
                </div>
              </div>
            )}
            {editingPeople === p.id ? (
              <fieldset className="mt-2 rounded-lg border bg-muted/30 p-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Who can pick {p.name}</legend>
                <p className="mb-2 text-xs text-muted-foreground">Tick the people who work on it. Leave everyone unticked to let everyone assigned to this client pick it.</p>
                {people.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is assigned to this client yet.</p> : null}
                <ul className="grid gap-1 sm:grid-cols-2">
                  {people.map((person) => (
                    <li key={person.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={`pp-${p.id}-${person.id}`}
                        checked={picked.includes(person.id)}
                        onCheckedChange={(on) => setPicked((cur) => (on ? [...cur, person.id] : cur.filter((x) => x !== person.id)))}
                      />
                      <label htmlFor={`pp-${p.id}-${person.id}`}>{person.name}</label>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={pending} onClick={() => run(() => setClientProjectPeople({ projectId: p.id, employeeIds: picked }), picked.length === 0 ? "Everyone on this client can pick it." : "Saved.", () => setEditingPeople(null))}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingPeople(null)}>
                    Cancel
                  </Button>
                </div>
              </fieldset>
            ) : null}
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createClientProject({ clientId: client.id, name }), "Project added.", () => setName(""));
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" aria-label={`New project name for ${client.name}`} className="max-w-64 flex-1" />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>
          <Plus aria-hidden /> Add project
        </Button>
      </form>

      {projects.length > 0 ? (
        <label htmlFor={`np-allow-${client.id}`} className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <Checkbox
            id={`np-allow-${client.id}`}
            className="mt-0.5"
            checked={client.allowNoProject}
            disabled={pending}
            onCheckedChange={(on) => run(() => setClientNoProjectAllowed({ clientId: client.id, allowed: Boolean(on) }), on ? "“No specific project” is shown on the clock." : "“No specific project” is hidden. People must pick a project.")}
          />
          <span>
            Offer “No specific project” on the clock
            <span className="block text-xs text-muted-foreground">Untick to make people pick one of the projects above. Someone who cannot see any project still clocks in for the client.</span>
          </span>
        </label>
      ) : null}
    </div>
  );
}

/** The client's own details, with edit and make inactive. */
function DetailsPanel({ client, timeZones }: { client: ClientItem; timeZones: readonly string[] }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [timeZone, setTimeZone] = useState(client.timeZone);
  const [holidayCalendar, setHolidayCalendar] = useState(client.holidayCalendar);
  const [handlesPhi, setHandlesPhi] = useState(client.handlesPhi);

  if (editing)
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateClient({ clientId: client.id, name, timeZone, holidayCalendar, isActive: client.isActive, handlesPhi }), "Client updated.", () => setEditing(false));
        }}
      >
        <h3 className="text-sm font-semibold">Edit details</h3>
        <TextField id={`ec-name-${client.id}`} label="Client name" value={name} onChange={(e) => setName(e.target.value)} required />
        <TimeZonePicker id={`ec-zone-${client.id}`} value={timeZone} onChange={setTimeZone} options={timeZones} />
        <SelectField id={`ec-cal-${client.id}`} label="Holidays" value={holidayCalendar} onChange={(e) => setHolidayCalendar(e.target.value as "PH" | "US")}>
          <option value="US">US holidays</option>
          <option value="PH">Philippine holidays</option>
        </SelectField>
        <PhiToggle id={`ec-phi-${client.id}`} checked={handlesPhi} onChange={setHandlesPhi} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Details</h3>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Time zone</dt>
          <dd>{client.timeZone}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Holidays</dt>
          <dd>{client.holidayCalendar === "PH" ? "Philippine" : "US"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Patient information</dt>
          <dd>{client.handlesPhi ? "Yes, full HIPAA training" : "No"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Status</dt>
          <dd>{client.isActive ? "Active" : "Inactive"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            run(
              () => updateClient({ clientId: client.id, name: client.name, timeZone: client.timeZone, holidayCalendar: client.holidayCalendar, isActive: !client.isActive, handlesPhi: client.handlesPhi }),
              client.isActive ? "Client marked inactive." : "Client marked active.",
            )
          }
        >
          {client.isActive ? "Mark inactive" : "Mark active"}
        </Button>
      </div>
    </div>
  );
}

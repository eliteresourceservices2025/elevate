"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import {
  archiveDepartment,
  archivePosition,
  archiveTeam,
  createDepartment,
  createPosition,
  createTeam,
  updateDepartment,
  updatePosition,
  updateTeam,
} from "../actions";

type Dept = { id: string; name: string };
type Team = { id: string; name: string; departmentId: string; members: number };
type Position = { id: string; title: string; departmentId: string | null; holders: number };

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  detail,
  onRename,
  onArchive,
  pending,
  extraFields,
}: {
  label: string;
  detail: string;
  onRename: (name: string, done: () => void) => void;
  onArchive: () => void;
  pending: boolean;
  extraFields?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label);

  if (!editing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div>
          <span className="font-medium">{label}</span>
          <span className="ml-2 text-sm text-muted-foreground">{detail}</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onArchive}>
            Archive
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="py-3">
      <form
        className="grid gap-3 sm:grid-cols-3 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          onRename(name, () => setEditing(false));
        }}
      >
        <TextField id={`rn-${label}`} label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        {extraFields}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  );
}

export function StructureAdmin({ departments, teams, positions }: { departments: Dept[]; teams: Team[]; positions: Position[] }) {
  const { run, pending } = useRun();
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "No department";

  const [newDept, setNewDept] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [newTeamDept, setNewTeamDept] = useState(departments[0]?.id ?? "");
  const [newPosition, setNewPosition] = useState("");
  const [newPositionDept, setNewPositionDept] = useState("");
  const [moveDept, setMoveDept] = useState<ReadonlyMap<string, string>>(new Map());

  return (
    <div className="space-y-10">
      <Card title="Departments" description="The top level. Each team belongs to one department.">
        <form
          className="flex max-w-xl items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createDepartment({ name: newDept }), "Department added.", () => setNewDept(""));
          }}
        >
          <div className="flex-1">
            <TextField id="nd" label="New department" value={newDept} onChange={(e) => setNewDept(e.target.value)} required />
          </div>
          <Button type="submit" disabled={pending || newDept.trim().length < 2}>
            Add
          </Button>
        </form>
        <ul className="divide-y rounded-xl border bg-card px-4">
          {departments.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No departments yet.</li> : null}
          {departments.map((d) => (
            <Row
              key={d.id}
              label={d.name}
              detail={`${teams.filter((t) => t.departmentId === d.id).length} teams`}
              pending={pending}
              onRename={(name, done) => run(() => updateDepartment({ departmentId: d.id, name }), "Department renamed.", done)}
              onArchive={() => window.confirm(`Archive "${d.name}"?`) && run(() => archiveDepartment({ departmentId: d.id }), "Department archived.")}
            />
          ))}
        </ul>
      </Card>

      <Card title="Teams" description="Where people sit. A person is in one team; their manager is set separately.">
        <form
          className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createTeam({ name: newTeam, departmentId: newTeamDept }), "Team added.", () => setNewTeam(""));
          }}
        >
          <TextField id="nt" label="New team" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} required />
          <SelectField id="ntd" label="Department" value={newTeamDept} onChange={(e) => setNewTeamDept(e.target.value)} required>
            {departments.length === 0 ? <option value="">Add a department first</option> : null}
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit" disabled={pending || !newTeamDept || newTeam.trim().length < 2}>
            Add team
          </Button>
        </form>
        <ul className="divide-y rounded-xl border bg-card px-4">
          {teams.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No teams yet.</li> : null}
          {teams.map((t) => (
            <Row
              key={t.id}
              label={t.name}
              detail={`${deptName(t.departmentId)} · ${t.members} ${t.members === 1 ? "person" : "people"}`}
              pending={pending}
              extraFields={
                <SelectField
                  id={`td-${t.id}`}
                  label="Department"
                  value={moveDept.get(t.id) ?? t.departmentId}
                  onChange={(e) => setMoveDept((prev) => new Map(prev).set(t.id, e.target.value))}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </SelectField>
              }
              onRename={(name, done) => run(() => updateTeam({ teamId: t.id, name, departmentId: moveDept.get(t.id) ?? t.departmentId }), "Team updated.", done)}
              onArchive={() => window.confirm(`Archive "${t.name}"?`) && run(() => archiveTeam({ teamId: t.id }), "Team archived.")}
            />
          ))}
        </ul>
      </Card>

      <Card title="Positions" description="The job titles people can hold. People pick from this list instead of typing a title.">
        <form
          className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createPosition({ title: newPosition, departmentId: newPositionDept }), "Position added.", () => setNewPosition(""));
          }}
        >
          <TextField id="np" label="New position" value={newPosition} onChange={(e) => setNewPosition(e.target.value)} required />
          <SelectField id="npd" label="Department (optional)" value={newPositionDept} onChange={(e) => setNewPositionDept(e.target.value)}>
            <option value="">Any</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <Button type="submit" disabled={pending || newPosition.trim().length < 2}>
            Add position
          </Button>
        </form>
        <ul className="divide-y rounded-xl border bg-card px-4">
          {positions.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No positions yet.</li> : null}
          {positions.map((p) => (
            <Row
              key={p.id}
              label={p.title}
              detail={`${p.holders} ${p.holders === 1 ? "person" : "people"}${p.departmentId ? ` · ${deptName(p.departmentId)}` : ""}`}
              pending={pending}
              onRename={(title, done) => run(() => updatePosition({ positionId: p.id, title, departmentId: p.departmentId ?? "" }), "Position renamed.", done)}
              onArchive={() => window.confirm(`Archive "${p.title}"?`) && run(() => archivePosition({ positionId: p.id }), "Position archived.")}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { PersonPicker, type PickerOption } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { reassignReports, setReporting } from "../actions";

type Props = {
  employeeId: string;
  current: { teamId: string | null; managerId: string | null };
  teams: { id: string; name: string }[];
  /** Everyone who could be a manager, without this person. */
  managers: PickerOption[];
  today: string;
  reportsCount: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** HR: change team and manager with an effective date (today or earlier), and move a manager's reports. */
export function ReportingForm({ employeeId, current, teams, managers, today, reportsCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const others = managers.filter((m) => m.id !== employeeId);

  const [teamId, setTeamId] = useState(current.teamId ?? "");
  const [manager, setManager] = useState<string | undefined>(current.managerId ?? undefined);
  const [date, setDate] = useState(today);

  const [moveTo, setMoveTo] = useState<string | undefined>(undefined);
  const [moveDate, setMoveDate] = useState(today);

  const managerInvalid = manager !== undefined && !UUID.test(manager);
  const moveInvalid = moveTo !== undefined && !UUID.test(moveTo);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (managerInvalid) return toast.error("Choose a manager from the list.");
    const nextTeam = teamId === "" ? null : teamId;
    const nextManager = manager ?? null;
    startTransition(async () => {
      const result = await setReporting({
        employeeId,
        // Only send what changed, so untouched values are left alone.
        ...(nextTeam !== current.teamId ? { teamId: nextTeam } : {}),
        ...(nextManager !== current.managerId ? { managerId: nextManager } : {}),
        effectiveDate: date,
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Reporting updated.");
      router.refresh();
    });
  }

  function reassign(e: React.FormEvent) {
    e.preventDefault();
    if (moveInvalid) return toast.error("Choose a manager from the list.");
    startTransition(async () => {
      const result = await reassignReports({ fromManagerId: employeeId, toManagerId: moveTo ?? null, effectiveDate: moveDate });
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${result.data.moved} ${result.data.moved === 1 ? "person" : "people"} reassigned.`);
      setMoveTo(undefined);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
        <h3 className="text-sm font-semibold">Team and manager</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField id="r-team" label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
          <PersonPicker id="r-manager" label="Manager" options={others} value={manager} onChange={setManager} error={managerInvalid ? "Choose a person from the list" : undefined} />
          <TextField id="r-date" label="Effective date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} hint="Today or earlier." required />
        </div>
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </form>

      {reportsCount > 0 ? (
        <form onSubmit={reassign} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
          <h3 className="text-sm font-semibold">
            Reassign {reportsCount} direct {reportsCount === 1 ? "report" : "reports"}
          </h3>
          <p className="text-sm text-muted-foreground">Moves everyone who reports to this person to someone else in one step. Leave the manager empty to have them report to no one.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <PersonPicker id="m-manager" label="New manager" options={others} value={moveTo} onChange={setMoveTo} error={moveInvalid ? "Choose a person from the list" : undefined} />
            <TextField id="m-date" label="Effective date" type="date" max={today} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} required />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Reassign
          </Button>
        </form>
      ) : null}
    </div>
  );
}

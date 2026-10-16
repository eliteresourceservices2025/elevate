"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useRun } from "@/modules/recruiting/components/use-run";
import { mergeDuplicate, relinkSignInAccount } from "../duplicates-actions";
import type { DuplicateReport } from "../duplicates-queries";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** One group of records that share a name: choose the one that stays (the oldest is pre-selected), then merge the others into it. */
function GroupCard({ group }: { group: DuplicateReport["groups"][number] }) {
  const { run, pending } = useRun();
  const [keepId, setKeepId] = useState(group.people[0].id);
  const [adoptEmail, setAdoptEmail] = useState(true);
  const others = group.people.filter((p) => p.id !== keepId);
  return (
    <section aria-label={group.people[0].name} className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">{group.people[0].name}</h3>
        <p className="text-sm text-muted-foreground">
          {group.people.length} records{group.signals.length ? `, with ${group.signals.join(" and ")}` : ", the same name only (they may be two different people)"}.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Keep this record</legend>
        {group.people.map((p) => (
          <label key={p.id} htmlFor={`keep-${p.id}`} className="flex items-start gap-2 rounded-lg border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <input id={`keep-${p.id}`} type="radio" name={`keep-${group.key}`} checked={keepId === p.id} onChange={() => setKeepId(p.id)} className="mt-1 size-4 accent-primary" />
            <span>
              <span className="font-medium">{p.workEmail}</span> · {p.status}
              {p.position ? ` · ${p.position}` : ""} · added {day(p.createdAt)} · {p.hasAccount ? "has a sign-in account" : "no sign-in account yet"}{" "}
              <Link href={`/people/${p.id}`} className="text-primary underline-offset-4 hover:underline">
                Open
              </Link>
            </span>
          </label>
        ))}
      </fieldset>
      <label htmlFor={`adopt-${group.key}`} className="flex items-start gap-2 text-sm">
        <input id={`adopt-${group.key}`} type="checkbox" checked={adoptEmail} onChange={(e) => setAdoptEmail(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
        <span>
          The record that stays takes the other record&apos;s work email
          <span className="block text-xs text-muted-foreground">Use this when the person changed their email: the account they sign in with now follows them, and so does that address.</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        {others.map((o) => (
          <Button
            key={o.id}
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Merge ${o.workEmail} into the record you kept? It is archived and nothing is deleted, but anything recorded on it (time clock, leave, documents) stays on the archived record.`)) return;
              run(() => mergeDuplicate({ keepId, duplicateId: o.id, adoptEmail: adoptEmail && o.hasAccount }), (d) => (d?.accountMoved ? "Merged. The sign-in account moved to the record that stays." : "Merged."));
            }}
          >
            Merge {o.workEmail} into the kept record
          </Button>
        ))}
      </div>
    </section>
  );
}

/** A sign-in account with no people record: pick the record it belongs to. */
function AccountRow({ account, records }: { account: DuplicateReport["accounts"][number]; records: DuplicateReport["records"] }) {
  const { run, pending } = useRun();
  const [employeeId, setEmployeeId] = useState("");
  const target = records.find((r) => r.id === employeeId);
  return (
    <li className="flex flex-wrap items-end gap-2 rounded-lg border p-3 text-sm">
      <div className="min-w-56 flex-1">
        <p className="font-medium">{account.email}</p>
        <p className="text-xs text-muted-foreground">Signed up {day(account.createdAt)}</p>
      </div>
      <div className="min-w-64 flex-1 space-y-1">
        <Label htmlFor={`link-${account.userId}`}>Belongs to</Label>
        <NativeSelect id={`link-${account.userId}`} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose a person</option>
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.workEmail}){r.hasAccount ? " - has another account" : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={pending || !employeeId}
        onClick={() => {
          const replace = Boolean(target?.hasAccount);
          if (replace && !window.confirm("That record already has a sign-in account. Replace it with this one? The old account stays, without a people record.")) return;
          run(() => relinkSignInAccount({ userId: account.userId, employeeId, replaceExisting: replace }), "Account linked.");
        }}
      >
        Link
      </Button>
    </li>
  );
}

export function DuplicatesPanel({ report }: { report: DuplicateReport }) {
  return (
    <div className="space-y-8">
      <section aria-label="Possible duplicates" className="space-y-3">
        <h2 className="text-lg font-semibold">People who may be in the directory twice</h2>
        {report.groups.length === 0 ? <p className="text-muted-foreground">No two records share a name.</p> : report.groups.map((g) => <GroupCard key={g.key} group={g} />)}
      </section>
      <section aria-label="Accounts without a record" className="space-y-3">
        <h2 className="text-lg font-semibold">Sign-in accounts with no people record</h2>
        <p className="text-sm text-muted-foreground">Someone who signed in with an email HR did not have on file. Link the account to their existing record so they do not get a second one.</p>
        {report.accounts.length === 0 ? <p className="text-muted-foreground">Every account has a record.</p> : <ul className="space-y-2">{report.accounts.map((a) => <AccountRow key={a.userId} account={a} records={report.records} />)}</ul>}
      </section>
    </div>
  );
}

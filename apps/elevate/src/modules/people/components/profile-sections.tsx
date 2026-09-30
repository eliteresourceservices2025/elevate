import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_TIMEZONE, SECONDARY_TIMEZONE, formatDateOnly, formatInZone } from "@/lib/time";
import type { SensitiveField } from "../constants";
import { SENSITIVE_LABELS, STATUS_LABELS } from "../constants";
import { legalName } from "../format";
import type { getProfile } from "../queries";
import { RevealField } from "./reveal-field";
import { AssignClientForm, CustomFieldsForm, EndAssignmentButton } from "./hr-panels";
import { SensitiveForm } from "./sensitive-form";
import { ReportingForm } from "@/modules/org/components/reporting-form";
import type { PickerOption } from "@/components/person-picker";
import { BankChangeForm, ContactChangeForm, EmergencyContactsForm } from "./self-service-forms";

export type Profile = Awaited<ReturnType<typeof getProfile>>;

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{children ?? "—"}</dd>
    </div>
  );
}

const DetailList = ({ children }: { children: ReactNode }) => (
  <dl className="divide-y rounded-xl border bg-card px-4">{children}</dl>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold">{title}</h2>
    {children}
  </section>
);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ");
const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const sensitiveLabel = (f: SensitiveField) => SENSITIVE_LABELS[f]; // eslint-disable-line security/detect-object-injection

export function PersonalSection({ profile }: { profile: Profile }) {
  const { employee: e, access } = profile;
  const address = [e.addressLine, e.city, e.province, e.postalCode, e.country].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      {access.limitedView ? (
        <p role="note" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Limited view: you see this person&apos;s work details. Birth date, civil status, personal email and home address are visible only to HR and the person.
        </p>
      ) : null}
      <DetailList>
        <Detail label="Legal name">{legalName(e)}</Detail>
        <Detail label="Preferred name">{dash(e.preferredName)}</Detail>
        <Detail label="Birth date">{formatDateOnly(e.birthDate)}</Detail>
        <Detail label="Civil status">{e.civilStatus ? cap(e.civilStatus) : "—"}</Detail>
        <Detail label="Work email">{e.workEmail}</Detail>
        <Detail label="Personal email">{dash(e.personalEmail)}</Detail>
        <Detail label="Mobile">{dash(e.mobile)}</Detail>
        <Detail label="Address">{dash(address)}</Detail>
      </DetailList>
      {access.canRequestChange ? (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-primary">Request a change to my contact details</summary>
          <div className="mt-3">
            <ContactChangeForm
              current={{ mobile: e.mobile ?? "", personalEmail: e.personalEmail ?? "", addressLine: e.addressLine ?? "", city: e.city ?? "", province: e.province ?? "", postalCode: e.postalCode ?? "" }}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

export type OrgFormOptions = { teams: { id: string; name: string }[]; managers: PickerOption[] };

export function EmploymentSection({ profile, orgOptions, today }: { profile: Profile; orgOptions?: OrgFormOptions; today: string }) {
  const { employee: e, access, customFields } = profile;
  return (
    <div className="space-y-6">
      <DetailList>
        <Detail label="Employee number">{e.employeeNumber}</Detail>
        <Detail label="Position">{dash(e.position)}</Detail>
        <Detail label="Status">
          <Badge variant={e.status === "active" ? "default" : "secondary"}>{STATUS_LABELS[e.status]}</Badge>
        </Detail>
        <Detail label="Team">{dash(e.teamName)}</Detail>
        <Detail label="Manager">{dash(e.managerName)}</Detail>
        {e.reportsCount > 0 ? <Detail label="Direct reports">{e.reportsCount}</Detail> : null}
        <Detail label="Worker type">{cap(e.workerType)}</Detail>
        <Detail label="Start date">{formatDateOnly(e.startDate)}</Detail>
        {e.endDate ? <Detail label="Last working day">{formatDateOnly(e.endDate)}</Detail> : null}
        {!access.canEdit
          ? customFields.map((f) => (
              <Detail key={f.id} label={f.label}>
                {dash(f.value)}
              </Detail>
            ))
          : null}
      </DetailList>
      {access.canManageReporting && orgOptions ? (
        <Section title="Reporting">
          <ReportingForm
            employeeId={e.id}
            current={{ teamId: e.teamId, managerId: e.managerId }}
            teams={orgOptions.teams}
            managers={orgOptions.managers}
            today={today}
            reportsCount={e.reportsCount}
          />
        </Section>
      ) : null}
      {access.canEdit ? (
        <Section title="Custom fields">
          <CustomFieldsForm employeeId={e.id} fields={customFields} />
        </Section>
      ) : null}
    </div>
  );
}

const ID_FIELDS = ["tin", "sss", "philhealth", "pagibig"] as const satisfies readonly SensitiveField[];
const PAYOUT_FIELDS = ["bankName", "bankAccountName", "bankAccountNumber", "payRate"] as const satisfies readonly SensitiveField[];

function SensitiveList({ profile, fields }: { profile: Profile; fields: readonly SensitiveField[] }) {
  const masks = profile.sensitive?.masks ?? {};
  return (
    <DetailList>
      {fields.map((f) => (
        <Detail key={f} label={sensitiveLabel(f)}>
          <RevealField
            employeeId={profile.employee.id}
            field={f}
            label={sensitiveLabel(f)}
            mask={new Map(Object.entries(masks)).get(f)}
            canReveal={profile.access.canViewSensitive}
          />
          {f === "payRate" && masks.payRate ? <span className="ml-2 text-xs text-muted-foreground">{profile.sensitive?.payCurrency} / month</span> : null}
        </Detail>
      ))}
    </DetailList>
  );
}

export function IdsSection({ profile }: { profile: Profile }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Encrypted. Shown masked; every reveal is logged.</p>
      <SensitiveList profile={profile} fields={ID_FIELDS} />
      {profile.access.canEditSensitive ? <SensitiveForm employeeId={profile.employee.id} fields={ID_FIELDS} /> : null}
    </div>
  );
}

export function PayoutSection({ profile }: { profile: Profile }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Encrypted. Shown masked; every reveal is logged.</p>
      <SensitiveList profile={profile} fields={PAYOUT_FIELDS} />
      {profile.access.canEditSensitive ? (
        <SensitiveForm employeeId={profile.employee.id} fields={PAYOUT_FIELDS} note={`Pay rate is in ${profile.sensitive?.payCurrency ?? "PHP"} per month.`} />
      ) : null}
      {profile.access.canRequestChange ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">Request a change to my bank details</summary>
          <div className="mt-3">
            <BankChangeForm />
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function EmergencySection({ profile }: { profile: Profile }) {
  const { emergencyContacts: contacts, access } = profile;
  return (
    <div className="space-y-6">
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No emergency contacts on file.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Relationship</TableHead>
              <TableHead>Phone</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  {c.name} {c.isPrimary ? <Badge variant="secondary" className="ml-1">Primary</Badge> : null}
                </TableCell>
                <TableCell>{c.relationship}</TableCell>
                <TableCell>{c.phone}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {access.canRequestChange ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-primary">Request a change to my emergency contacts</summary>
          <div className="mt-3">
            <EmergencyContactsForm current={contacts.map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone, isPrimary: c.isPrimary }))} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function ClientsSection({
  profile,
  clients,
  today,
}: {
  profile: Profile;
  clients: { id: string; name: string; isActive: boolean }[];
  today: string;
}) {
  const { assignments, access, employee } = profile;
  return (
    <div className="space-y-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Client time zone</TableHead>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Hours / week</TableHead>
            {access.canManageAssignments ? <TableHead className="text-right">Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {assignments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No client assignments.
              </TableCell>
            </TableRow>
          ) : null}
          {assignments.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.clientName}</TableCell>
              <TableCell>{a.clientTimeZone}</TableCell>
              <TableCell>{formatDateOnly(a.startDate)}</TableCell>
              <TableCell>{a.endDate ? formatDateOnly(a.endDate) : <Badge>Current</Badge>}</TableCell>
              <TableCell>{a.hoursPerWeek ?? "—"}</TableCell>
              {access.canManageAssignments ? (
                <TableCell className="text-right">{a.endDate ? null : <EndAssignmentButton assignmentId={a.id} today={today} />}</TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {access.canManageAssignments ? (
        <Section title="Assign a client">
          <AssignClientForm employeeId={employee.id} clients={clients} today={today} />
        </Section>
      ) : null}
    </div>
  );
}

export function HistorySection({ profile }: { profile: Profile }) {
  if (profile.history.length === 0) return <p className="text-sm text-muted-foreground">No history yet.</p>;
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Times in {DEFAULT_TIMEZONE} and {SECONDARY_TIMEZONE}. History cannot be edited or deleted. Changes to IDs and bank details
        are listed without their values.
      </p>
      <ol className="space-y-3">
        {profile.history.map((h) => (
          <li key={h.id} className="rounded-lg border bg-card p-3">
            <p className="text-sm font-medium">{h.summary}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Effective {formatDateOnly(h.effectiveDate)} · recorded {formatInZone(h.createdAt, DEFAULT_TIMEZONE, "MMM d, yyyy h:mm a")} /{" "}
              {formatInZone(h.createdAt, SECONDARY_TIMEZONE, "h:mm a")}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

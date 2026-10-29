"use client";

/* eslint-disable security/detect-object-injection -- numeric list indexes */
import { useState } from "react";
import { toast } from "@/components/feedback-dialog";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archiveEnvelope, archiveTemplate, deleteTestEnvelope, discardDraft, findSignees, remindSigners, sendEnvelope, setEnvelopeTest, voidEnvelope } from "../actions";
import { DEFAULT_EXPIRY_DAYS, MAX_PDF_BYTES, MAX_SIGNERS } from "../constants";
import type { SignerChoice, SigneeGroups, TemplateRow } from "../queries";
import { useRouter } from "next/navigation";
import { ComposeEditor } from "./compose-editor";
import { BUILTIN_TEMPLATES } from "../builtin-templates";
import { SEND_FIELDS, fieldsUsed, sendFieldsUsed } from "../merge";
import { useAsk } from "@/components/confirm-dialog";
import { useFormDialogWork } from "@/components/form-dialog";

import { Textarea } from "@/components/ui/textarea";

type Picked = { userId: string; role: string };

/** HR: send a PDF (or a saved template) to one or more people to sign. */
export function NewEnvelopeForm({ people, templates, groups, initialTemplateId }: { people: SignerChoice[]; templates: TemplateRow[]; groups: SigneeGroups; initialTemplateId?: string }) {
  const ask = useAsk();
  const router = useRouter();
  const template = templates.find((t) => t.id === initialTemplateId) ?? null;
  const [title, setTitle] = useState(template?.name ?? "");
  const [source, setSource] = useState<"write" | "upload" | "template">(template ? "template" : "write");
  const [content, setContent] = useState("");
  const [initialEachPage, setInitialEachPage] = useState(false);
  const [templateId, setTemplateId] = useState(template?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [order, setOrder] = useState<"sequential" | "parallel">("sequential");
  const [expiryDays, setExpiryDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [picked, setPicked] = useState<Picked[]>(template ? template.roles.map(() => ({ userId: "", role: "" })).map((p, i) => ({ ...p, role: template.roles[i] })) : []);
  const [add, setAdd] = useState("");
  const [sending, setSending] = useState(false);
  // Everyone, a team or a client: each person signs their own copy (their own document, signature and sealed file).
  const [isTest, setIsTest] = useState(false);
  const [copies, setCopies] = useState(false);
  const [sharedRole, setSharedRole] = useState("");
  const [signeeDetails, setSigneeDetails] = useState<string[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>(() => Object.fromEntries(SEND_FIELDS.flatMap((f) => (f.initial ? [[f.key, f.initial]] : []))));
  const [counterId, setCounterId] = useState("");
  const [counterRole, setCounterRole] = useState("");
  const [groupKind, setGroupKind] = useState<"everyone" | "team" | "client">("everyone");
  const [groupId, setGroupId] = useState("");
  const [finding, setFinding] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const many = picked.length > MAX_SIGNERS;
  const individual = copies || many;

  const chosen = templates.find((t) => t.id === templateId) ?? null;
  const taken = new Set(picked.map((p) => p.userId));

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setTitle((s) => s || t.name);
      setPicked(t.roles.map((role) => ({ userId: "", role })));
    }
  }

  /** Fills the title, the text and the signer role from a ready-made document. HR can still change all of it before sending. */
  async function applyBuiltin(id: string) {
    const t = BUILTIN_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if ((content.trim() || title.trim()) && !(await ask("Replace what you have written with this ready-made document?"))) return;
    setTitle(t.title);
    setContent(t.body);
    setSharedRole(t.roles[0] ?? "");
    setSigneeDetails(t.signeeDetails ?? []);
    // The countersigner and per-person copies belong to the document picked, not to the one before it
    setCounterId("");
    setCounterRole(t.countersignerRole ?? "");
    setCopies(Boolean(t.countersignerRole));
    setPicked((list) => (list.length ? list.map((p, i) => ({ ...p, role: p.role || (t.roles[i] ?? "") })) : list));
  }

  /** Adds the people of a group (everyone, a team, or a client's current assignments). The list comes from the server. */
  async function addGroup() {
    setFinding(true);
    try {
      const r = await findSignees({ kind: groupKind, id: groupKind === "everyone" ? undefined : groupId });
      if (!r.ok) return void toast.error(r.error);
      const have = new Set(picked.map((p) => p.userId));
      const fresh = r.data.people.filter((x) => !have.has(x.userId) && x.userId !== counterId);
      if (fresh.length === 0) return void toast.message("Everyone in that group is already added.");
      setPicked((l) => [...l, ...fresh.map((x) => ({ userId: x.userId, role: "" }))].slice(0, 500));
      if (picked.length + fresh.length > MAX_SIGNERS) setCopies(true);
      toast.success(`Added ${fresh.length} ${fresh.length === 1 ? "person" : "people"}.`);
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setFinding(false);
    }
  }

  async function submit(send: boolean) {
    const signers = picked.filter((p) => p.userId);
    if (signers.length !== picked.length) return void toast.error("Choose a person for every role.");
    if (individual && counterId && signers.some((p) => p.userId === counterId)) return void toast.error("The countersigner cannot also be one of the people signing their own copy. Remove them from the list.");
    if (source === "write" && content.trim().length < 20) return void toast.error("Write the document (at least a few sentences).");
    if (source === "upload" && !file) return void toast.error("Attach the PDF.");
    if (source === "upload" && file && file.size > MAX_PDF_BYTES) return void toast.error("The PDF must be 8 MB or smaller.");
    if (source === "template" && !templateId) return void toast.error("Choose a template.");
    const post = async (batch: Picked[], each: boolean, check = false) => {
      const form = new FormData();
      form.set("title", title);
      form.set("order", order);
      form.set("expiryDays", expiryDays);
      form.set("send", String(send));
      form.set("signers", JSON.stringify(batch.map((p, i) => ({ userId: p.userId, role: p.role || sharedRole, position: i + 1 }))));
      if (each) form.set("individual", "true");
      if (source === "write") {
        form.set("inputs", JSON.stringify(inputs));
        if (signeeDetails.length) form.set("signeeDetails", JSON.stringify(signeeDetails));
      }
      if (each && counterId) form.set("countersigner", JSON.stringify({ userId: counterId, role: counterRole }));
      if (initialEachPage) form.set("initialEachPage", "true");
      if (isTest) form.set("isTest", "true");
      if (source === "write") form.set("content", content);
      else if (source === "template") form.set("templateId", templateId);
      else if (file) form.set("file", file);
      const response = await fetch(check ? "/api/signing/envelopes?check=1" : "/api/signing/envelopes", { method: "POST", body: form });
      return (await response.json().catch(() => null)) as { ok: boolean; error?: string; id?: string; count?: number } | null;
    };
    setSending(true);
    try {
      if (individual) {
        if (send && signers.length > 1 && !(await ask(`Send this document to ${signers.length} people, each as their own copy?`))) return;
        // Details filled in from people's records: check everyone first, so a missing address stops the send before anyone gets a copy.
        if (source === "write" && fieldsUsed(content).length > 0) {
          for (let i = 0; i < signers.length; i += MAX_SIGNERS) {
            const checked = await post(signers.slice(i, i + MAX_SIGNERS), true, true);
            if (!checked?.ok) return void toast.error(checked?.error ?? "Something went wrong. Please try again.");
          }
        }
        let done = 0;
        for (let i = 0; i < signers.length; i += MAX_SIGNERS) {
          const batch = signers.slice(i, i + MAX_SIGNERS);
          setProgress({ done, total: signers.length });
          const body = await post(batch, true);
          if (!body?.ok) {
            const made = done + (body?.count ?? 0);
            return void toast.error(`${body?.error ?? "Something went wrong. Please try again."} ${made} of ${signers.length} were ${send ? "sent" : "saved"} before it stopped. Check Signing before trying again, so nobody gets two.`);
          }
          done += body.count ?? batch.length;
        }
        toast.success(send ? `Sent to ${done} ${done === 1 ? "person" : "people"}.` : `Saved ${done} drafts.`);
        router.push("/signing");
        return;
      }
      const body = await post(signers, false);
      if (!body?.ok || !body.id) return void toast.error(body?.error ?? "Something went wrong. Please try again.");
      toast.success(send ? "Sent for signature." : "Saved as a draft.");
      router.push(`/signing/${body.id}`);
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  const move = (i: number, d: -1 | 1) =>
    setPicked((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <form
      className="space-y-5 rounded-xl border bg-card p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
    >
      <TextField id="env-title" label="Document title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">The document</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label htmlFor="env-src-write" className="flex items-center gap-2">
            <input id="env-src-write" type="radio" name="source" checked={source === "write"} onChange={() => setSource("write")} className="size-4 accent-primary" />
            Write or paste it here
          </label>
          <label htmlFor="env-src-upload" className="flex items-center gap-2">
            <input id="env-src-upload" type="radio" name="source" checked={source === "upload"} onChange={() => setSource("upload")} className="size-4 accent-primary" />
            Upload a PDF
          </label>
          <label htmlFor="env-src-template" className="flex items-center gap-2">
            <input id="env-src-template" type="radio" name="source" checked={source === "template"} onChange={() => setSource("template")} className="size-4 accent-primary" disabled={templates.length === 0} />
            Use a template {templates.length === 0 ? "(none saved yet)" : ""}
          </label>
        </div>
        {source === "write" ? (
          <div className="space-y-3">
            <SelectField id="env-builtin" label="Start from a ready-made document (optional)" value="" onChange={(e) => applyBuiltin(e.target.value)}>
              <option value="">Blank document</option>
              {BUILTIN_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            <ComposeEditor value={content} onChange={setContent} title={title} />
            {sendFieldsUsed(content).length > 0 ? (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium">Fill in for this send</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {sendFieldsUsed(content).map((f) => (
                    <div key={f.key} className={f.kind === "textarea" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
                      {f.kind === "textarea" ? (
                        <>
                          <Label htmlFor={`send-${f.key}`}>{f.label}</Label>
                          <Textarea id={`send-${f.key}`} rows={4} maxLength={f.max} value={inputs[f.key] ?? ""} onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))} />
                        </>
                      ) : f.kind === "choice" ? (
                        <SelectField id={`send-${f.key}`} label={f.label} value={inputs[f.key] ?? ""} onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}>
                          {(f.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </SelectField>
                      ) : (
                        <TextField id={`send-${f.key}`} label={f.label} value={inputs[f.key] ?? ""} onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))} maxLength={f.max} />
                      )}
                      {f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">These are the same on every copy in this send. A document with different terms per person is sent one person at a time.</p>
              </div>
            ) : null}
            {signeeDetails.length > 0 ? <p className="text-xs text-muted-foreground">The person will also be asked to type in their {signeeDetails.length} details (bank information) when signing. Those are kept encrypted and printed on the signed copy.</p> : null}
          </div>
        ) : source === "upload" ? (
          <div className="space-y-1.5">
            <Label htmlFor="env-file">PDF (up to 8 MB, 100 pages)</Label>
            <input id="env-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-secondary file:px-3 file:py-1.5" />
            <p className="text-xs text-muted-foreground">Signatures are added on a page at the end. Do not include client or patient information.</p>
          </div>
        ) : (
          <SelectField id="env-template" label="Template" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
            <option value="">Choose a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.pages} pages)
              </option>
            ))}
          </SelectField>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who signs</legend>
        {picked.length === 0 ? <p className="text-sm text-muted-foreground">Add at least one person. They need an ELEVATE account.</p> : null}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
          <div className="w-44">
            <SelectField
              id="env-group-kind"
              label="Add a group"
              value={groupKind}
              onChange={(e) => {
                setGroupKind(e.target.value as "everyone" | "team" | "client");
                setGroupId("");
              }}
            >
              <option value="everyone">Everyone ({groups.everyone})</option>
              <option value="team" disabled={groups.teams.length === 0}>
                A team
              </option>
              <option value="client" disabled={groups.clients.length === 0}>
                A client&apos;s assignees
              </option>
            </SelectField>
          </div>
          {groupKind === "team" ? (
            <div className="min-w-48 flex-1">
              <SelectField id="env-group-team" label="Team" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Choose a team</option>
                {groups.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.count})
                  </option>
                ))}
              </SelectField>
            </div>
          ) : null}
          {groupKind === "client" ? (
            <div className="min-w-48 flex-1">
              <SelectField id="env-group-client" label="Client" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Choose a client</option>
                {groups.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.count})
                  </option>
                ))}
              </SelectField>
            </div>
          ) : null}
          <Button type="button" variant="outline" disabled={finding || (groupKind !== "everyone" && !groupId)} onClick={() => void addGroup()}>
            Add them
          </Button>
          <p className="basis-full text-xs text-muted-foreground">Adds the people who currently have an ELEVATE account. A client adds the people assigned to it today.</p>
        </div>
        <label htmlFor="env-copies" className="flex items-start gap-2 text-sm">
          <input id="env-copies" type="checkbox" className="mt-0.5 size-4 accent-primary" checked={individual} disabled={many} onChange={(e) => setCopies(e.target.checked)} />
          <span>
            Each person signs their own copy
            <span className="block text-xs text-muted-foreground">One document per person, each with its own signature and signed copy. Used for policies sent to many people{many ? " (on, because more than 10 people are added)" : ""}.</span>
          </span>
        </label>
        {individual ? (
          <div className="space-y-3">
            <div className="max-w-sm">
              <TextField id="env-shared-role" label="Role shown on each document (optional)" value={sharedRole} onChange={(e) => setSharedRole(e.target.value)} maxLength={60} placeholder="Contractor" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <SelectField
                  id="env-counter"
                  label="Countersigned by the Company (optional, signs after each person)"
                  value={counterId}
                  onChange={(e) => {
                    setCounterId(e.target.value);
                    // The countersigner cannot also sign their own copy
                    setPicked((l) => l.filter((p) => p.userId !== e.target.value));
                  }}
                >
                  <option value="">No countersigner</option>
                  {people
                    .filter((x) => !taken.has(x.userId) || x.userId === counterId)
                    .map((x) => (
                      <option key={x.userId} value={x.userId}>
                        {x.name} ({x.email})
                      </option>
                    ))}
                </SelectField>
              </div>
              {counterId ? (
                <div className="w-64">
                  <TextField id="env-counter-role" label="Their role on the document" value={counterRole} onChange={(e) => setCounterRole(e.target.value)} maxLength={60} placeholder="ERS representative" />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {many ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{picked.length} people</p>
            <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
              {picked.map((p, i) => {
                const person = people.find((x) => x.userId === p.userId);
                return (
                  <li key={p.userId} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span>{person ? `${person.name} (${person.email})` : p.userId}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPicked((l) => l.filter((_, k) => k !== i))} aria-label={`Remove ${person?.name ?? "person"}`}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicked([])}>
              Remove everyone
            </Button>
          </div>
        ) : null}
        <ol className={many ? "hidden" : "space-y-2"}>
          {picked.map((p, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <span className="w-6 pb-2 text-sm text-muted-foreground">{order === "sequential" ? `${i + 1}.` : ""}</span>
              <div className="min-w-56 flex-1">
                <SelectField id={`env-p-${i}`} label={chosen ? `Person for ${p.role}` : "Person"} value={p.userId} onChange={(e) => setPicked((l) => l.map((x, k) => (k === i ? { ...x, userId: e.target.value } : x)))}>
                  <option value="">Choose a person</option>
                  {people
                    .filter((x) => !taken.has(x.userId) || x.userId === p.userId)
                    .map((x) => (
                      <option key={x.userId} value={x.userId}>
                        {x.name} ({x.email})
                      </option>
                    ))}
                </SelectField>
              </div>
              <div className="w-48">
                <TextField id={`env-r-${i}`} label="Role (shown on the document)" value={p.role} onChange={(e) => setPicked((l) => l.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)))} maxLength={60} />
              </div>
              {order === "sequential" && !individual ? (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move person ${i + 1} up`}>
                    Up
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === picked.length - 1} aria-label={`Move person ${i + 1} down`}>
                    Down
                  </Button>
                </>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked((l) => l.filter((_, k) => k !== i))} aria-label={`Remove person ${i + 1}`}>
                Remove
              </Button>
            </li>
          ))}
        </ol>
        {picked.length < MAX_SIGNERS || individual ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <SelectField id="env-add" label="Add a signee" value={add} onChange={(e) => setAdd(e.target.value)}>
                <option value="">Choose a person</option>
                {people
                  .filter((x) => !taken.has(x.userId) && x.userId !== counterId)
                  .map((x) => (
                    <option key={x.userId} value={x.userId}>
                      {x.name} ({x.email})
                    </option>
                  ))}
              </SelectField>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!add}
              onClick={() => {
                setPicked((l) => [...l, { userId: add, role: "" }]);
                setAdd("");
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {individual ? (
          <p className="self-end text-sm text-muted-foreground">Each person gets their own document, so there is no signing order.</p>
        ) : (
          <SelectField id="env-order" label="Signing order" value={order} onChange={(e) => setOrder(e.target.value as "sequential" | "parallel")}>
            <option value="sequential">One after another, in the order above</option>
            <option value="parallel">Everyone at the same time</option>
          </SelectField>
        )}
        <TextField id="env-expiry" label="Days to sign before it expires" type="number" min={1} max={90} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
      </div>

      <label htmlFor="env-initials" className="flex items-start gap-2 text-sm">
        <input id="env-initials" type="checkbox" className="mt-0.5 size-4 accent-primary" checked={initialEachPage} onChange={(e) => setInitialEachPage(e.target.checked)} />
        <span>
          Each person initials every page before signing
          <span className="block text-xs text-muted-foreground">They read the document page by page and initial each one. The initials are stamped at the foot of every page of the signed copy.</span>
        </span>
      </label>

      <label htmlFor="env-test" className="flex items-start gap-2 text-sm">
        <input id="env-test" type="checkbox" className="mt-0.5 size-4 accent-primary" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
        <span>
          This is a test
          <span className="block text-xs text-muted-foreground">It is marked &ldquo;Test&rdquo; everywhere, so it can be archived later, and deleted by a Super Admin. Use it when you are trying the flow out.</span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={sending || picked.length === 0}>
          {progress ? `Sending ${progress.done} of ${progress.total}...` : individual && picked.length > 1 ? `Send to ${picked.length} people` : "Send for signature"}
        </Button>
        <Button type="button" variant="outline" disabled={sending || picked.length === 0} onClick={() => void submit(false)}>
          Save as draft
        </Button>
      </div>
    </form>
  );
}

/** HR: save a PDF as a reusable template with the roles it needs. */
export function NewTemplateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState("Contractor, ERS representative");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const dialog = useFormDialogWork({ dirty: Boolean(name || description || file || roles !== "Contractor, ERS representative"), busy: saving });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return void toast.error("Attach the PDF.");
    const form = new FormData();
    form.set("name", name);
    form.set("description", description);
    form.set("roles", JSON.stringify(roles.split(",").map((r) => r.trim()).filter(Boolean)));
    form.set("file", file);
    setSaving(true);
    try {
      const response = await fetch("/api/signing/templates", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!body?.ok) return void toast.error(body?.error ?? "Something went wrong. Please try again.");
      toast.success("Template saved.");
      setName("");
      setDescription("");
      setFile(null);
      await dialog?.close(true);
      router.refresh();
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-4">
      <fieldset disabled={saving} className="space-y-3">
      {dialog ? null : <h3 className="font-semibold">Save a template</h3>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="tpl-name" label="Template name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        <TextField id="tpl-roles" label="Signee roles, in order, separated by commas" value={roles} onChange={(e) => setRoles(e.target.value)} />
      </div>
      <TextField id="tpl-desc" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      <div className="space-y-1.5">
        <Label htmlFor="tpl-file">PDF</Label>
        <input id="tpl-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-secondary file:px-3 file:py-1.5" />
      </div>
      <Button type="submit" size="sm" disabled={saving}>
        Save template
      </Button>
      </fieldset>
    </form>
  );
}

export function ArchiveTemplateButton({ templateId }: { templateId: string }) {
  const { run, pending } = useRun();
  const ask = useAsk();
  return (
    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={async () => (await ask("Archive this template? Documents already sent are not affected.")) && run(() => archiveTemplate({ templateId }), "Template archived.")}>
      Archive
    </Button>
  );
}

/** HR controls on one envelope. */
export function ManageButtons({ envelopeId, title = "", status, sealing, isTest = false, archived = false, canDelete = false }: { envelopeId: string; title?: string; status: string; sealing: boolean; isTest?: boolean; archived?: boolean; canDelete?: boolean }) {
  const { run, pending, router } = useRun();
  const ask = useAsk();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => run(() => sendEnvelope({ envelopeId }), "Sent for signature.")}>
              Send for signature
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={async () => (await ask("Discard this draft?")) && run(() => discardDraft({ envelopeId }), "Draft discarded.")}>
              Discard draft
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setEnvelopeTest({ envelopeId, isTest: !isTest }), isTest ? "Test mark removed." : "Marked as a test.")}>
          {isTest ? "Remove test mark" : "Mark as test"}
        </Button>
        {status !== "out" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => archiveEnvelope({ envelopeId, archived: !archived }), archived ? "Restored." : "Archived.")}>
            {archived ? "Restore from archive" : "Archive"}
          </Button>
        ) : null}
        {isTest && canDelete ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              const why = window.prompt(`Delete "${title}" (${status}) permanently, with its signed copy and log? This cannot be undone. Check it really is a test. Why are you deleting it?`);
              if (why === null) return;
              run(
                () => deleteTestEnvelope({ envelopeId, reason: why }),
                (data) => (data?.filesRemoved === false ? "Deleted, but its files could not be removed from storage. Tell an administrator." : "Deleted."),
                () => router.push("/signing?tab=all&view=test"),
              );
            }}
          >
            Delete permanently
          </Button>
        ) : null}
        {status === "out" && !sealing ? (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => remindSigners({ envelopeId }), "Reminder sent.")}>
              Remind signers
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setVoiding((v) => !v)}>
              Void this document
            </Button>
          </>
        ) : null}
      </div>
      {voiding ? (
        <form
          className="max-w-md space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!(await ask("Void this document? Nobody will be able to sign it."))) return;
            run(() => voidEnvelope({ envelopeId, reason }), "Document voided.");
          }}
        >
          <TextField id="void-reason" label="Why is it being voided?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            Void
          </Button>
        </form>
      ) : null}
    </div>
  );
}

"use client";

/* eslint-disable security/detect-object-injection -- numeric list indexes */
import { useState } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archiveTemplate, discardDraft, remindSigners, sendEnvelope, voidEnvelope } from "../actions";
import { DEFAULT_EXPIRY_DAYS, MAX_PDF_BYTES, MAX_SIGNERS } from "../constants";
import type { SignerChoice, TemplateRow } from "../queries";
import { useRouter } from "next/navigation";

type Picked = { userId: string; role: string };

/** HR: send a PDF (or a saved template) to one or more people to sign. */
export function NewEnvelopeForm({ people, templates, initialTemplateId }: { people: SignerChoice[]; templates: TemplateRow[]; initialTemplateId?: string }) {
  const router = useRouter();
  const template = templates.find((t) => t.id === initialTemplateId) ?? null;
  const [title, setTitle] = useState(template?.name ?? "");
  const [source, setSource] = useState<"upload" | "template">(template ? "template" : "upload");
  const [templateId, setTemplateId] = useState(template?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [order, setOrder] = useState<"sequential" | "parallel">("sequential");
  const [expiryDays, setExpiryDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [picked, setPicked] = useState<Picked[]>(template ? template.roles.map(() => ({ userId: "", role: "" })).map((p, i) => ({ ...p, role: template.roles[i] })) : []);
  const [add, setAdd] = useState("");
  const [sending, setSending] = useState(false);

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

  async function submit(send: boolean) {
    const signers = picked.filter((p) => p.userId);
    if (signers.length !== picked.length) return void toast.error("Choose a person for every role.");
    if (source === "upload" && !file) return void toast.error("Attach the PDF.");
    if (source === "upload" && file && file.size > MAX_PDF_BYTES) return void toast.error("The PDF must be 8 MB or smaller.");
    if (source === "template" && !templateId) return void toast.error("Choose a template.");
    const form = new FormData();
    form.set("title", title);
    form.set("order", order);
    form.set("expiryDays", expiryDays);
    form.set("send", String(send));
    form.set("signers", JSON.stringify(signers.map((p, i) => ({ userId: p.userId, role: p.role, position: i + 1 }))));
    if (source === "template") form.set("templateId", templateId);
    else if (file) form.set("file", file);
    setSending(true);
    try {
      const response = await fetch("/api/signing/envelopes", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as { ok: boolean; error?: string; id?: string } | null;
      if (!body?.ok || !body.id) return void toast.error(body?.error ?? "Something went wrong. Please try again.");
      toast.success(send ? "Sent for signature." : "Saved as a draft.");
      router.push(`/signing/${body.id}`);
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setSending(false);
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
          <label htmlFor="env-src-upload" className="flex items-center gap-2">
            <input id="env-src-upload" type="radio" name="source" checked={source === "upload"} onChange={() => setSource("upload")} className="size-4 accent-primary" />
            Upload a PDF
          </label>
          <label htmlFor="env-src-template" className="flex items-center gap-2">
            <input id="env-src-template" type="radio" name="source" checked={source === "template"} onChange={() => setSource("template")} className="size-4 accent-primary" disabled={templates.length === 0} />
            Use a template {templates.length === 0 ? "(none saved yet)" : ""}
          </label>
        </div>
        {source === "upload" ? (
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
        <ol className="space-y-2">
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
              {order === "sequential" ? (
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
        {picked.length < MAX_SIGNERS ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <SelectField id="env-add" label="Add a signer" value={add} onChange={(e) => setAdd(e.target.value)}>
                <option value="">Choose a person</option>
                {people
                  .filter((x) => !taken.has(x.userId))
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
        <SelectField id="env-order" label="Signing order" value={order} onChange={(e) => setOrder(e.target.value as "sequential" | "parallel")}>
          <option value="sequential">One after another, in the order above</option>
          <option value="parallel">Everyone at the same time</option>
        </SelectField>
        <TextField id="env-expiry" label="Days to sign before it expires" type="number" min={1} max={90} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={sending || picked.length === 0}>
          Send for signature
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
      router.refresh();
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-4">
      <h3 className="font-semibold">Save a template</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="tpl-name" label="Template name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        <TextField id="tpl-roles" label="Signer roles, in order, separated by commas" value={roles} onChange={(e) => setRoles(e.target.value)} />
      </div>
      <TextField id="tpl-desc" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      <div className="space-y-1.5">
        <Label htmlFor="tpl-file">PDF</Label>
        <input id="tpl-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-secondary file:px-3 file:py-1.5" />
      </div>
      <Button type="submit" size="sm" disabled={saving}>
        Save template
      </Button>
    </form>
  );
}

export function ArchiveTemplateButton({ templateId }: { templateId: string }) {
  const { run, pending } = useRun();
  return (
    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Archive this template? Documents already sent are not affected.") && run(() => archiveTemplate({ templateId }), "Template archived.")}>
      Archive
    </Button>
  );
}

/** HR controls on one envelope. */
export function ManageButtons({ envelopeId, status, sealing }: { envelopeId: string; status: string; sealing: boolean }) {
  const { run, pending } = useRun();
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
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Discard this draft?") && run(() => discardDraft({ envelopeId }), "Draft discarded.")}>
              Discard draft
            </Button>
          </>
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
          onSubmit={(e) => {
            e.preventDefault();
            if (!window.confirm("Void this document? Nobody will be able to sign it.")) return;
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

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archiveAsset, assignAsset, createAsset, returnAsset, setAssetStatus, updateAsset } from "../actions";
import { ASSET_STATUSES, CATEGORIES, CATEGORY_LABELS, CONDITIONS, CONDITION_LABELS, RETURN_STATUSES, STATUS_LABELS, canSetStatus, defaultReturnStatus, type AssetStatus, type Category, type Condition, type ReturnStatus } from "../constants";

const box = "space-y-3 rounded-xl border bg-card p-4";

/** HR registers an item. Warns against putting private data in the notes. */
export function RegisterAssetForm() {
  const { run, pending, router } = useRun();
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("laptop");
  const [serialNumber, setSerialNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createAsset({ tag, name, category, serialNumber, purchaseDate, notes }), "Item registered.", (d) => router.push(`/assets/${encodeURIComponent((d as { tag: string }).tag)}`));
      }}
    >
      <h2 className="text-lg font-semibold">Register an item</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="asset-tag">Asset tag</Label>
          <Input id="asset-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ERS-LT-0001" maxLength={30} required className="font-mono uppercase" />
          <p className="text-xs text-muted-foreground">Printed on the label. It cannot be changed later.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="asset-name">Name</Label>
          <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dell Latitude 5440" maxLength={120} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asset-category">Category</Label>
          <NativeSelect id="asset-category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="asset-serial">Serial number (optional)</Label>
          <Input id="asset-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="asset-purchased">Purchase date (optional)</Label>
          <Input id="asset-purchased" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="asset-notes">Notes (optional)</Label>
        <Textarea id="asset-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
        <p className="text-xs text-muted-foreground">Only HR sees notes. Please do not store passwords, prices or client or patient information.</p>
      </div>
      <Button type="submit" disabled={pending}>
        Register item
      </Button>
    </form>
  );
}

type AssetFields = { id: string; name: string; category: Category; serialNumber: string | null; notes: string | null; purchaseDate: string | null };

export function EditAssetForm({ asset }: { asset: AssetFields }) {
  const { run, pending } = useRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(asset.name);
  const [category, setCategory] = useState<Category>(asset.category);
  const [serialNumber, setSerialNumber] = useState(asset.serialNumber ?? "");
  const [purchaseDate, setPurchaseDate] = useState(asset.purchaseDate ?? "");
  const [notes, setNotes] = useState(asset.notes ?? "");
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Edit details</Button>;
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateAsset({ assetId: asset.id, name, category, serialNumber, purchaseDate, notes }), "Saved.", () => setOpen(false));
      }}
    >
      <h2 className="text-lg font-semibold">Edit details</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-category">Category</Label>
          <NativeSelect id="edit-category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-serial">Serial number</Label>
          <Input id="edit-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-purchased">Purchase date</Label>
          <Input id="edit-purchased" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="edit-notes">Notes</Label>
        <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AssignForm({ assetId, people }: { assetId: string; people: { id: string; name: string; position: string | null }[] }) {
  const { run, pending } = useRun();
  const [employeeId, setEmployeeId] = useState("");
  const [condition, setCondition] = useState<Condition>("good");
  const [note, setNote] = useState("");
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => assignAsset({ assetId, employeeId, condition, note }), "Item assigned. The person was notified.");
      }}
    >
      <h2 className="text-lg font-semibold">Assign to a person</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="assign-person">Person</Label>
          <NativeSelect id="assign-person" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            <option value="">Choose a person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.position ? ` (${p.position})` : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="assign-condition">Condition when handed over</Label>
          <NativeSelect id="assign-condition" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="assign-note">Note (optional)</Label>
        <Input id="assign-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <Button type="submit" disabled={pending || !employeeId}>
        Hand over
      </Button>
    </form>
  );
}

const RETURN_LABELS: Record<ReturnStatus, string> = { in_stock: "Back in stock", repair: "Needs repair", lost: "Not recovered (lost)", retired: "Retire it" };

export function ReturnForm({ assetId }: { assetId: string }) {
  const { run, pending } = useRun();
  const [condition, setCondition] = useState<Condition>("good");
  const [nextStatus, setNextStatus] = useState<ReturnStatus>("in_stock");
  const [note, setNote] = useState("");
  return (
    <form
      className={box}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => returnAsset({ assetId, condition, nextStatus, note }), "Return recorded.");
      }}
    >
      <h2 className="text-lg font-semibold">Record the return</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="return-condition">Condition when received</Label>
          <NativeSelect
            id="return-condition"
            value={condition}
            onChange={(e) => {
              const c = e.target.value as Condition;
              setCondition(c);
              // A damaged item should not go straight back to stock: offer repair, but HR can change it
              if (nextStatus === "in_stock" || nextStatus === "repair") setNextStatus(defaultReturnStatus(c));
            }}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-next">Then the item is</Label>
          <NativeSelect id="return-next" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as ReturnStatus)}>
            {RETURN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RETURN_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="return-note">Note (optional)</Label>
        <Input id="return-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <Button type="submit" disabled={pending}>
        Record return
      </Button>
    </form>
  );
}

/** Status and archive controls for an item that is not with anyone. */
export function StatusControls({ assetId, status, archived, canArchive }: { assetId: string; status: AssetStatus; archived: boolean; canArchive: boolean }) {
  const { run, pending } = useRun();
  const next = ASSET_STATUSES.filter((s) => canSetStatus(status, s));
  return (
    <div className="flex flex-wrap items-end gap-3">
      {!archived && next.length > 0 ? (
        <div className="space-y-1">
          <Label htmlFor="status-next">Change status</Label>
          <NativeSelect id="status-next" value="" disabled={pending} onChange={(e) => e.target.value && run(() => setAssetStatus({ assetId, status: e.target.value }), "Status updated.")}>
            <option value="">Choose</option>
            {next.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      {archived ? (
        <Button variant="outline" disabled={pending} onClick={() => run(() => archiveAsset({ assetId, archive: false }), "Item restored.")}>
          Restore item
        </Button>
      ) : canArchive ? (
        <Button variant="outline" disabled={pending} onClick={() => run(() => archiveAsset({ assetId, archive: true }), "Item archived. Its history is kept.")}>
          Archive item
        </Button>
      ) : null}
    </div>
  );
}

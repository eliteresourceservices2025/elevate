"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Folder, FolderPlus } from "lucide-react";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { archiveFolder, createFolder, renameFolder } from "../actions";
import type { DocumentRow, FolderRow } from "../queries";
import { DocumentList } from "./document-list";

const ALL = "all";
const NONE = "none";

/**
 * A person's documents with folders and pages. A row of folder buttons filters the list ("All", "No folder", then each folder with its
 * count), the list is paged, and each document can be moved to a folder from its row. The person (and HR) make and remove folders.
 */
export function DocumentLibrary({ employeeId, rows, folders, canOrganize, viewerIsHr }: { employeeId: string; rows: DocumentRow[]; folders: FolderRow[]; canOrganize: boolean; viewerIsHr: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<string>(ALL);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  // A folder that was just removed is no longer there to be selected.
  const active = view === ALL || view === NONE || folders.some((f) => f.id === view) ? view : ALL;
  const folder = folders.find((f) => f.id === active) ?? null;
  const shown = rows.filter((r) => (active === ALL ? true : active === NONE ? r.folderId === null || !folders.some((f) => f.id === r.folderId) : r.folderId === active));
  const paged = usePaged(shown, active);
  const countIn = (id: string) => rows.filter((r) => r.folderId === id).length;
  const unfiled = rows.filter((r) => r.folderId === null || !folders.some((f) => f.id === r.folderId)).length;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      after?.();
      router.refresh();
    });

  const chip = (id: string, label: string, count: number, icon = false) => (
    <button
      key={id}
      type="button"
      aria-pressed={active === id}
      onClick={() => {
        setView(id);
        setRenaming(false);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active === id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary/60",
      )}
    >
      {icon ? <Folder className="size-3.5" aria-hidden /> : null}
      {label}
      <span className={cn("rounded-full px-1.5 text-xs", active === id ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Folders" className="flex flex-wrap items-center gap-2">
        {chip(ALL, "All", rows.length)}
        {folders.length > 0 || unfiled > 0 ? chip(NONE, "No folder", unfiled) : null}
        {folders.map((f) => chip(f.id, f.name, countIn(f.id), true))}
        {canOrganize ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <FolderPlus aria-hidden /> New folder
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createFolder({ employeeId, name }), "Folder created.", () => {
              setName("");
              setAdding(false);
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input id="folder-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="For example: Contracts" className="w-64 max-w-full" required />
          </div>
          <Button type="submit" size="sm" disabled={pending || name.trim() === ""}>
            Create folder
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <p className="basis-full text-xs text-muted-foreground">Use a plain name. Do not put private details or client names in a folder name.</p>
        </form>
      ) : null}

      {folder && canOrganize ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {renaming ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => renameFolder({ folderId: folder.id, name: newName }), "Folder renamed.", () => setRenaming(false));
              }}
            >
              <Label htmlFor="folder-rename" className="sr-only">
                New name for {folder.name}
              </Label>
              <Input id="folder-rename" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} className="h-8 w-56" required />
              <Button type="submit" size="sm" disabled={pending || newName.trim() === ""}>
                Save name
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <span className="text-muted-foreground">Folder: {folder.name}</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setNewName(folder.name);
                  setRenaming(true);
                }}
              >
                Rename
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  window.confirm(`Remove the folder "${folder.name}"? Its documents are kept and move to "No folder".`) &&
                  run(() => archiveFolder({ folderId: folder.id }), "Folder removed.", () => setView(ALL))
                }
              >
                Remove folder
              </Button>
            </>
          )}
        </div>
      ) : null}

      <DocumentList
        rows={paged.rows}
        viewerIsHr={viewerIsHr}
        folders={canOrganize ? folders : undefined}
        emptyText={active === ALL ? "No documents uploaded yet." : "Nothing in this folder yet. Move a document here from its row."}
      />
      <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="documents" />
    </div>
  );
}

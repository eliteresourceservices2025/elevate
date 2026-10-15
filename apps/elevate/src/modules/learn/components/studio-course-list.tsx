"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RemoveAddonButton } from "./studio-editors";

// The studio's course list: made to stay pleasant with many courses and client add-ons. Search by title, client or address, narrow
// by what it is or where it stands, and see the core courses and the client add-ons in their own groups. Plain data in, no fetching.

export type StudioListCourse = {
  slug: string;
  title: string;
  kind: "core" | "client_addon";
  clientName: string | null;
  studioManaged: boolean;
  versions: number;
  liveVersion: number | null;
  draftVersion: number | null;
  counselApprovedOn: string | null;
  updatedAt: string | null;
  /** A client add-on that never went live: it can be removed. */
  removable: boolean;
};

type Filter = "all" | "core" | "addon" | "draft" | "unpublished";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "core", label: "Core courses" },
  { key: "addon", label: "Client add-ons" },
  { key: "draft", label: "Has a draft" },
  { key: "unpublished", label: "Not published" },
];

const matches = (c: StudioListCourse, f: Filter) =>
  f === "all"
    ? true
    : f === "core"
      ? c.kind === "core"
      : f === "addon"
        ? c.kind === "client_addon"
        : f === "draft"
          ? c.draftVersion !== null
          : c.liveVersion === null;

function CourseCard({ c }: { c: StudioListCourse }) {
  return (
    <li className="flex h-full flex-col justify-between gap-4 rounded-xl border bg-card p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {c.liveVersion !== null ? (
            <Badge>Live: version {c.liveVersion}</Badge>
          ) : (
            <Badge variant="outline">Not published</Badge>
          )}
          {c.draftVersion !== null ? (
            <Badge variant="outline">Draft: version {c.draftVersion}</Badge>
          ) : null}
        </div>
        <h3 className="text-base leading-snug font-semibold">
          <Link
            href={`/course-studio/${c.slug}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {c.title}
          </Link>
        </h3>
        <p className="text-sm text-muted-foreground">
          {c.kind === "client_addon"
            ? `Client add-on${c.clientName ? ` for ${c.clientName}` : ""}`
            : "Core course"}{" "}
          · {c.versions} {c.versions === 1 ? "version" : "versions"}
          {c.counselApprovedOn ? ` · counsel approved ${c.counselApprovedOn}` : ""}
          {c.updatedAt ? ` · changed ${c.updatedAt.slice(0, 10)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={
            c.draftVersion !== null
              ? `/course-studio/${c.slug}/${c.draftVersion}`
              : `/course-studio/${c.slug}`
          }
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          {c.draftVersion !== null ? "Continue the draft" : "Open"}
        </Link>
        {c.removable ? <RemoveAddonButton course={c.slug} title={c.title} /> : null}
      </div>
    </li>
  );
}

function Group({
  title,
  note,
  items,
}: {
  title: string;
  note?: string;
  items: StudioListCourse[];
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">
          {title}{" "}
          <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
        </h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((c) => (
          <CourseCard key={c.slug} c={c} />
        ))}
      </ul>
    </section>
  );
}

export function StudioCourseList({ courses }: { courses: StudioListCourse[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter(
      (c) =>
        matches(c, filter) &&
        (q === "" || `${c.title} ${c.clientName ?? ""} ${c.slug}`.toLowerCase().includes(q)),
    );
  }, [courses, query, filter]);
  const core = shown.filter((c) => c.kind === "core");
  const addons = shown
    .filter((c) => c.kind === "client_addon")
    .sort(
      (a, b) =>
        (a.clientName ?? a.title).localeCompare(b.clientName ?? b.title) ||
        a.title.localeCompare(b.title),
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-sm">
          <label htmlFor="studio-search" className="sr-only">
            Search courses
          </label>
          <Input
            id="studio-search"
            type="search"
            placeholder="Search by course, client or code"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${filter === f.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground" role="status">
        Showing {shown.length} of {courses.length} {courses.length === 1 ? "course" : "courses"}.
      </p>

      {shown.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          Nothing matches. Clear the search or choose another filter.
        </p>
      ) : null}
      <Group title="Core courses" note="HIPAA and Cybersecurity basics." items={core} />
      <Group
        title="Client add-ons"
        note="Short courses written for one client's requirements."
        items={addons}
      />
    </div>
  );
}

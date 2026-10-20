"use client";

import { ClientPager, usePaged } from "@/components/client-pager";
import type { DocumentRow } from "../queries";
import { DocumentFilterBar, GroupedDocuments, useDocumentFilters } from "./document-filters";
import { DocumentList } from "./document-list";

/** The company's documents with the same type chips, search and grouping as a person's Documents tab, and pages. */
export function CompanyDocuments({ rows, viewerIsHr, showAudience }: { rows: DocumentRow[]; viewerIsHr: boolean; showAudience: boolean }) {
  const filters = useDocumentFilters(rows);
  const paged = usePaged(filters.filtered, `${filters.type}|${filters.q}`);
  const empty = filters.filtering ? "No document matches." : "No company documents yet.";
  return (
    <div className="space-y-3">
      {rows.length > 0 ? <DocumentFilterBar filters={filters} /> : null}
      {filters.group === "none" ? (
        <>
          <DocumentList rows={paged.rows} viewerIsHr={viewerIsHr} showAudience={showAudience} emptyText={empty} />
          <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="documents" />
        </>
      ) : (
        <GroupedDocuments rows={filters.filtered} group="type" viewerIsHr={viewerIsHr} showAudience={showAudience} emptyText={empty} />
      )}
    </div>
  );
}

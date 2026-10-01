// One place for the paging rule: every long list shows a page at a time, 25 rows unless the person picks another size.

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type PageInfo = { page: number; pageSize: number; total: number; pages: number; from: number; to: number; offset: number };

const toInt = (v: unknown) => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Reads ?page and ?size from the address (any garbage falls back to the defaults). */
export function parsePaging(raw: { page?: unknown; size?: unknown }, defaultSize: number = DEFAULT_PAGE_SIZE): { page: number; pageSize: number } {
  const size = toInt(raw.size);
  const page = toInt(raw.page);
  return {
    page: page && page > 0 ? page : 1,
    pageSize: size !== null && (PAGE_SIZES as readonly number[]).includes(size) ? size : defaultSize,
  };
}

/** Works out the window for a list of `total` rows. A page past the end snaps to the last page. */
export function pageInfo(total: number, page: number, pageSize: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const offset = (p - 1) * pageSize;
  return { page: p, pageSize, total, pages, offset, from: total === 0 ? 0 : offset + 1, to: Math.min(total, offset + pageSize) };
}

/** Cuts an in-memory list down to one page. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): { rows: T[]; info: PageInfo } {
  const info = pageInfo(rows.length, page, pageSize);
  return { rows: rows.slice(info.offset, info.offset + pageSize), info };
}

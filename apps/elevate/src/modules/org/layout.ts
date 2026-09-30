import { hierarchy, tree } from "d3-hierarchy";

// Pure layout for the org chart: no React, no database. Safe to unit test.

export type LayoutInput = { id: string; managerId: string | null; name: string };

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 84;
const H_GAP = 28;
const V_GAP = 56;
export const VIRTUAL_ROOT = "__root";

export type Positioned = { id: string; x: number; y: number; depth: number; virtual: boolean };
export type Edge = { id: string; source: string; target: string };
export type Layout = {
  nodes: Positioned[];
  edges: Edge[];
  /** Everyone below each person (all levels). */
  descendants: Map<string, number>;
  /** Direct reports of each person. */
  childIds: Map<string, string[]>;
  parentOf: Map<string, string | null>;
};

type TreeDatum = { id: string; children: TreeDatum[] };

/** Index the people by manager. A manager id that is not in the list makes that person a top-level person. */
export function indexPeople(people: readonly LayoutInput[]) {
  const ids = new Set(people.map((p) => p.id));
  const childIds = new Map<string, string[]>();
  const parentOf = new Map<string, string | null>();
  const roots: string[] = [];

  for (const p of people) {
    const parent = p.managerId && ids.has(p.managerId) && p.managerId !== p.id ? p.managerId : null;
    parentOf.set(p.id, parent);
    if (parent) childIds.set(parent, [...(childIds.get(parent) ?? []), p.id]);
    else roots.push(p.id);
  }
  return { childIds, parentOf, roots };
}

/**
 * Top-down tree layout. People in `collapsed` hide everything below them. With several top-level
 * people a virtual root ("Elite Resource Services") sits above them; with one there is none.
 * The database forbids loops, but this also guards against one so a bad row can never hang the page.
 */
export function layoutOrgChart(people: readonly LayoutInput[], collapsed: ReadonlySet<string> = new Set()): Layout {
  const { childIds, parentOf, roots } = indexPeople(people);

  const descendants = new Map<string, number>();
  const count = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    let n = 0;
    for (const c of childIds.get(id) ?? []) n += 1 + count(c, seen);
    descendants.set(id, n);
    return n;
  };
  for (const r of roots) count(r, new Set());

  const visited = new Set<string>();
  const build = (id: string): TreeDatum => {
    visited.add(id);
    const kids = collapsed.has(id) ? [] : (childIds.get(id) ?? []).filter((c) => !visited.has(c));
    return { id, children: kids.map(build) };
  };

  const useVirtual = roots.length !== 1;
  const rootDatum: TreeDatum = useVirtual
    ? { id: VIRTUAL_ROOT, children: roots.map(build) }
    : build(roots[0]);

  if (people.length === 0) return { nodes: [], edges: [], descendants, childIds, parentOf };

  const root = hierarchy<TreeDatum>(rootDatum, (d) => d.children);
  tree<TreeDatum>().nodeSize([NODE_WIDTH + H_GAP, NODE_HEIGHT + V_GAP])(root);

  const nodes: Positioned[] = [];
  const edges: Edge[] = [];
  for (const n of root.descendants()) {
    nodes.push({ id: n.data.id, x: n.x ?? 0, y: n.y ?? 0, depth: n.depth, virtual: n.data.id === VIRTUAL_ROOT });
    if (n.parent) edges.push({ id: `${n.parent.data.id}->${n.data.id}`, source: n.parent.data.id, target: n.data.id });
  }
  return { nodes, edges, descendants, childIds, parentOf };
}

/** Every person who has at least one report: the ones that can be collapsed. */
export function managersOf(people: readonly LayoutInput[]): string[] {
  const { childIds } = indexPeople(people);
  return [...childIds.keys()];
}

/** The chain of managers above a person, nearest first. Used to reveal someone found by search. */
export function ancestorsOf(people: readonly LayoutInput[], id: string): string[] {
  const { parentOf } = indexPeople(people);
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf.get(id) ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

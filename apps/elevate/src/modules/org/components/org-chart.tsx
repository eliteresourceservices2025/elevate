"use client";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ancestorsOf, layoutOrgChart, managersOf, NODE_HEIGHT, NODE_WIDTH, VIRTUAL_ROOT } from "../layout";
import type { ChartNode } from "../queries";

type PersonData = { person: ChartNode; reports: number; collapsed: boolean; hasChildren: boolean; highlighted: boolean };

type Actions = { toggle: (id: string) => void; open: (p: ChartNode) => void };
const ActionsContext = createContext<Actions>({ toggle: () => {}, open: () => {} });

function PersonNode({ data }: NodeProps<Node<PersonData, "person">>) {
  const { toggle, open } = useContext(ActionsContext);
  const { person, reports, collapsed, hasChildren, highlighted } = data;

  return (
    <div
      className={cn("rounded-xl border bg-card shadow-sm", highlighted ? "ring-2 ring-brand-gold" : "")}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" isConnectable={false} />
      <button
        type="button"
        onClick={() => open(person)}
        className="block h-full w-full rounded-xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${person.name}, ${person.position ?? "no position"}${person.team ? `, ${person.team}` : ""}. ${person.canOpen ? "Open profile" : "Show details"}`}
      >
        <span className="block truncate text-sm font-semibold">{person.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{person.position ?? "No position"}</span>
        <span className="mt-1 flex items-center gap-1.5">
          {person.team ? <span className="truncate text-[0.7rem] text-primary">{person.team}</span> : null}
          {person.status !== "active" ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[0.6rem]">
              {person.status.replace("_", " ")}
            </Badge>
          ) : null}
        </span>
      </button>
      {hasChildren ? (
        <button
          type="button"
          onClick={() => toggle(person.id)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Show" : "Hide"} ${reports} ${reports === 1 ? "person" : "people"} under ${person.name}`}
          className="absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border bg-background px-2 text-[0.65rem] font-medium shadow-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronRight className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
          {reports}
        </button>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!opacity-0" isConnectable={false} />
    </div>
  );
}

function RootNode() {
  return (
    <div className="flex items-center justify-center rounded-full border bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground" style={{ width: NODE_WIDTH }}>
      Elite Resource Services
      <Handle type="source" position={Position.Bottom} className="!opacity-0" isConnectable={false} />
    </div>
  );
}

const nodeTypes = { person: PersonNode, root: RootNode };

function Chart({ people }: { people: ChartNode[] }) {
  const router = useRouter();
  const flow = useReactFlow();
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // Large companies start with the lower levels folded so the first view is readable.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    if (people.length <= 80) return new Set();
    const layout = layoutOrgChart(people);
    return new Set(layout.nodes.filter((n) => n.depth >= 2 && !n.virtual).map((n) => n.id));
  });
  const [query, setQuery] = useState("");
  // highlightId keeps the ring on the last person found; centerOn asks for ONE centering move.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [centerOn, setCenterOn] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChartNode | null>(null);

  const layout = useMemo(() => layoutOrgChart(people, collapsed), [people, collapsed]);

  const { nodes, edges } = useMemo(() => {
    const flowNodes: Node[] = layout.nodes.map((n) => {
      if (n.virtual) {
        return { id: n.id, type: "root", position: { x: n.x - NODE_WIDTH / 2, y: n.y }, data: {}, draggable: false, selectable: false } as Node;
      }
      const person = byId.get(n.id)!;
      const data: PersonData = {
        person,
        reports: layout.descendants.get(n.id) ?? 0,
        hasChildren: (layout.childIds.get(n.id)?.length ?? 0) > 0,
        collapsed: collapsed.has(n.id),
        highlighted: n.id === highlightId,
      };
      return { id: n.id, type: "person", position: { x: n.x - NODE_WIDTH / 2, y: n.y }, data, draggable: false, selectable: false } as Node;
    });
    const flowEdges: Edge[] = layout.edges.map((e) => ({ ...e, type: "smoothstep", selectable: false, focusable: false }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [layout, byId, collapsed, highlightId]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return people.filter((p) => `${p.name} ${p.position ?? ""} ${p.team ?? ""}`.toLowerCase().includes(q)).slice(0, 8);
  }, [people, query]);

  // After the tree re-lays out (a branch was opened to reveal someone), center on them.
  useEffect(() => {
    if (!centerOn) return;
    const target = layout.nodes.find((n) => n.id === centerOn);
    if (!target) return;
    const t = setTimeout(() => {
      void flow.setCenter(target.x, target.y + NODE_HEIGHT / 2, { zoom: 1, duration: 500 });
      setCenterOn(null); // one move only, so later expand/collapse clicks are not fought
    }, 50);
    return () => clearTimeout(t);
  }, [centerOn, layout, flow]);

  const actions: Actions = {
    toggle: (id) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    open: (p) => (p.canOpen ? router.push(`/people/${p.id}`) : setSelected(p)),
  };

  function reveal(p: ChartNode) {
    const above = ancestorsOf(people, p.id);
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const a of above) next.delete(a);
      return next;
    });
    setHighlightId(p.id);
    setCenterOn(p.id);
    setSelected(p.canOpen ? null : p);
    setQuery("");
  }

  return (
    <ActionsContext.Provider value={actions}>
      <div className="h-[70vh] min-h-[420px] rounded-xl border bg-card" role="region" aria-label="Organization chart">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.5 }} // readable first view; pan, search or use the minimap for wide charts
          minZoom={0.1}
          maxZoom={1.75}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => (n.id === VIRTUAL_ROOT ? "#6c1aba" : "#e2be2b")} ariaLabel="Chart overview" />
          <Panel position="top-left" className="w-72 max-w-[85vw] space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Find a person on the chart"
                placeholder="Find a person"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="bg-background pl-8"
              />
            </div>
            {matches.length > 0 ? (
              <ul className="overflow-hidden rounded-lg border bg-background shadow-md" aria-label="Search results">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => reveal(m)} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                      <span className="font-medium">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">{m.position ?? "No position"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <Button type="button" size="xs" variant="outline" className="bg-background" onClick={() => setCollapsed(new Set())}>
                Expand all
              </Button>
              <Button type="button" size="xs" variant="outline" className="bg-background" onClick={() => setCollapsed(new Set(managersOf(people)))}>
                Collapse all
              </Button>
            </div>
          </Panel>
          {selected ? (
            <Panel position="bottom-center" className="w-80 max-w-[90vw]">
              <div role="status" className="rounded-xl border bg-background p-4 text-sm shadow-lg">
                <p className="font-semibold">{selected.name}</p>
                <p className="text-muted-foreground">{selected.position ?? "No position"}</p>
                {selected.team ? <p>Team: {selected.team}</p> : null}
                <p className="mt-2 text-xs text-muted-foreground">You can see directory details for this person, but not their profile.</p>
                <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={() => setSelected(null)}>
                  Close
                </Button>
              </div>
            </Panel>
          ) : null}
        </ReactFlow>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Scroll to zoom, drag to move. Prefer a list? Use{" "}
        <Link href="/org-chart?view=list" className="text-primary underline-offset-4 hover:underline">
          list view
        </Link>
        .
      </p>
    </ActionsContext.Provider>
  );
}

export function OrgChart({ people }: { people: ChartNode[] }) {
  if (people.length === 0) return <p className="text-muted-foreground">No one to show yet.</p>;
  return (
    <ReactFlowProvider>
      <Chart people={people} />
    </ReactFlowProvider>
  );
}

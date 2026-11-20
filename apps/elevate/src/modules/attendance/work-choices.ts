// What a person can pick on the clock: a client with no projects is one choice; a client with projects offers each project and then
// the client with no specific project. Pure, so the web clock and its tests share it.

export type WorkChoice = { clientId: string; projectId: string | undefined; label: string };

export function workChoices(clients: readonly { id: string; name: string; projects: readonly { id: string; name: string }[] }[]): WorkChoice[] {
  return clients.flatMap((c): WorkChoice[] =>
    c.projects.length === 0
      ? [{ clientId: c.id, projectId: undefined, label: c.name }]
      : [...c.projects.map((p) => ({ clientId: c.id, projectId: p.id, label: `${c.name} · ${p.name}` })), { clientId: c.id, projectId: undefined, label: `${c.name} · no specific project` }],
  );
}

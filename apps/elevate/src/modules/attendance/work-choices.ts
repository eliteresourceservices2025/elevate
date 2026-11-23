// What a person can pick on the clock: a client with no projects is one choice; a client with projects offers each project and then
// the client with no specific project. Pure, so the web clock and its tests share it.
//
// `label` is the full sentence form ("Acme · Intake", used in messages). `clientName`, `title` and `grouped` are for menus: a client that
// has projects is shown once as a small heading, with each project (and "No specific project") as a short line under it.

export type WorkChoice = { clientId: string; projectId: string | undefined; label: string; clientName: string; title: string; grouped: boolean };

export function workChoices(clients: readonly { id: string; name: string; projects: readonly { id: string; name: string }[] }[]): WorkChoice[] {
  return clients.flatMap((c): WorkChoice[] =>
    c.projects.length === 0
      ? [{ clientId: c.id, projectId: undefined, label: c.name, clientName: c.name, title: c.name, grouped: false }]
      : [
          ...c.projects.map((p) => ({ clientId: c.id, projectId: p.id, label: `${c.name} · ${p.name}`, clientName: c.name, title: p.name, grouped: true })),
          { clientId: c.id, projectId: undefined, label: `${c.name} · no specific project`, clientName: c.name, title: "No specific project", grouped: true },
        ],
  );
}

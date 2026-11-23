import { describe, expect, it } from "vitest";
import { workChoices } from "./work-choices";

describe("what a person can clock in for", () => {
  it("lists a client with no projects as just the client", () => {
    expect(workChoices([{ id: "c1", name: "Acme", projects: [] }])).toEqual([{ clientId: "c1", projectId: undefined, label: "Acme", clientName: "Acme", title: "Acme", grouped: false }]);
  });

  it("lists each project of a client, then the client with no specific project", () => {
    const got = workChoices([{ id: "c1", name: "Acme", projects: [{ id: "p1", name: "Intake" }, { id: "p2", name: "Billing" }] }]);
    expect(got).toEqual([
      { clientId: "c1", projectId: "p1", label: "Acme · Intake", clientName: "Acme", title: "Intake", grouped: true },
      { clientId: "c1", projectId: "p2", label: "Acme · Billing", clientName: "Acme", title: "Billing", grouped: true },
      { clientId: "c1", projectId: undefined, label: "Acme · no specific project", clientName: "Acme", title: "No specific project", grouped: true },
    ]);
  });

  it("keeps the clients in the order given, mixing clients with and without projects", () => {
    const got = workChoices([
      { id: "c1", name: "Acme", projects: [{ id: "p1", name: "Intake" }] },
      { id: "c2", name: "Beta", projects: [] },
    ]);
    expect(got.map((c) => c.label)).toEqual(["Acme · Intake", "Acme · no specific project", "Beta"]);
  });

  it("is empty for a person with no clients", () => {
    expect(workChoices([])).toEqual([]);
  });
});

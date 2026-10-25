import { expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  withUser: async (_sql: unknown, _user: string, callback: (tx: unknown) => unknown) =>
    callback(async () => [{ id: "renewal-1", title: "HIPAA", slug: "hipaa", track: "full", status: "assigned", due_on: "2026-11-25", reason: "renewal" }]),
}));

const { listAssignments } = await import("./queries");

it("preserves the assignment reason needed to label a yearly renewal", async () => {
  const rows = await listAssignments(null as never, "test-user");
  expect(rows[0]).toMatchObject({ reason: "renewal" });
});

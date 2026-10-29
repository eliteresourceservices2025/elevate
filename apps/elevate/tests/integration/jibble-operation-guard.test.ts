import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { claimJibbleOperation, finishJibbleOperation, markJibbleInFlight, markJibbleSettled, markJibbleUncertain, runGuardedJibbleEffect } from "@/modules/jibble/operation-guard";

async function employee(): Promise<string> {
  const [row] = (await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status)
    values ('Guard', ${randomUUID()}, ${`${randomUUID()}@example.com`}, 'active') returning id`)) as unknown as { id: string }[];
  return row.id;
}

describe("durable Jibble operation guard", () => {
  it("permits only one simultaneous owner per person while allowing another person", async () => {
    const first = await employee();
    const second = await employee();
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimJibbleOperation(first, { kind: "send" })));
    const token = claims.find((claim): claim is string => claim !== null);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimJibbleOperation(second, { kind: "repair" })).not.toBeNull();
    expect(await finishJibbleOperation(first, token!)).toBe(true);
    expect(await claimJibbleOperation(first, { kind: "send" })).not.toBeNull();
  });

  it("does not let a different owner or an uncertain operation be released", async () => {
    const person = await employee();
    const token = (await claimJibbleOperation(person, { kind: "send" }))!;
    const operation = { action: "Out" as const, jibblePersonId: "test-person", logId: randomUUID() };
    expect(await markJibbleInFlight(person, randomUUID(), operation)).toBe(false);
    expect(await markJibbleInFlight(person, token, operation)).toBe(true);
    const [record] = (await db.execute(sql`select action, log_id, jibble_person_id from time.jibble_operation_guard where employee_id = ${person}`)) as unknown as { action: string; log_id: string; jibble_person_id: string }[];
    expect(record).toMatchObject({ action: "Out", log_id: operation.logId, jibble_person_id: "test-person" });
    expect(await markJibbleUncertain(person, token)).toBe(true);
    expect(await finishJibbleOperation(person, token)).toBe(false);
    expect(await claimJibbleOperation(person, { kind: "repair" })).toBeNull();
  });

  it("does not hand over an in-flight reservation when its worker disappears", async () => {
    const person = await employee();
    const token = (await claimJibbleOperation(person, { kind: "send" }))!;
    expect(await markJibbleInFlight(person, token, { action: "In", jibblePersonId: "test-person" })).toBe(true);
    await db.execute(sql`update time.jibble_operation_guard set updated_at = now() - interval '1 day' where employee_id = ${person}`);
    expect(await claimJibbleOperation(person, { kind: "reconcile" })).toBeNull();
  });

  it("can retain ownership across recorded operations without letting another worker take over", async () => {
    const person = await employee();
    const token = (await claimJibbleOperation(person, { kind: "send" }))!;
    expect(await markJibbleInFlight(person, token, { action: "In", jibblePersonId: "test-person" })).toBe(true);
    expect(await markJibbleSettled(person, token)).toBe(true);
    expect(await claimJibbleOperation(person, { kind: "repair" })).toBeNull();
    expect(await markJibbleInFlight(person, token, { action: "Out", jibblePersonId: "test-person" })).toBe(true);
    expect(await finishJibbleOperation(person, token)).toBe(false);
    expect(await markJibbleSettled(person, token)).toBe(true);
    expect(await finishJibbleOperation(person, token)).toBe(true);
  });

  it("retains an uncertain operation when the provider or result persistence fails", async () => {
    for (const failsIn of ["send", "persist"] as const) {
      const person = await employee();
      const token = (await claimJibbleOperation(person, { kind: "send" }))!;
      await expect(runGuardedJibbleEffect({
        employeeId: person, token, operation: { action: "In", jibblePersonId: "test-person" },
        send: async () => { if (failsIn === "send") throw new Error("timeout"); return "accepted"; },
        persist: async () => { if (failsIn === "persist") throw new Error("database unavailable"); },
      })).rejects.toThrow();
      const [guard] = (await db.execute(sql`select phase from time.jibble_operation_guard where employee_id = ${person}`)) as unknown as { phase: string }[];
      expect(guard.phase).toBe("uncertain");
      expect(await claimJibbleOperation(person, { kind: "repair" })).toBeNull();
    }
  });

  it("settles only after saving a successful provider response", async () => {
    const person = await employee();
    const token = (await claimJibbleOperation(person, { kind: "send" }))!;
    let persisted = false;
    const result = await runGuardedJibbleEffect({
      employeeId: person, token, operation: { action: "Out", jibblePersonId: "test-person" },
      send: async () => "accepted",
      persist: async (value) => {
        expect(value).toBe("accepted");
        const [guard] = (await db.execute(sql`select phase from time.jibble_operation_guard where employee_id = ${person}`)) as unknown as { phase: string }[];
        expect(guard.phase).toBe("in_flight");
        persisted = true;
      },
    });
    expect(result).toBe("accepted");
    expect(persisted).toBe(true);
    expect(await finishJibbleOperation(person, token)).toBe(true);
  });

  it("prevents a second worker sending while an external call is still running", async () => {
    const person = await employee();
    const token = (await claimJibbleOperation(person, { kind: "send" }))!;
    let unblock!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { unblock = resolve; });
    const called = new Promise<void>((resolve) => { started = resolve; });
    const running = runGuardedJibbleEffect({
      employeeId: person, token, operation: { action: "In", jibblePersonId: "test-person" },
      send: async () => { started(); await waiting; return "accepted"; },
      persist: async () => {},
    });
    await called;
    expect(await claimJibbleOperation(person, { kind: "repair" })).toBeNull();
    unblock();
    await expect(running).resolves.toBe("accepted");
    expect(await finishJibbleOperation(person, token)).toBe(true);
  });
});

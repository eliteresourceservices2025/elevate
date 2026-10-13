import { describe, expect, it } from "vitest";
import { incidentReference, kindLabel, statusLabel } from "./constants";
import { designatePrivacyOfficerSchema, replyIncidentSchema, reportIncidentSchema, setIncidentStatusSchema } from "./validators";

const ID = "11111111-1111-4111-8111-111111111111";
const base = { kind: "wrong_recipient", happenedOn: "2026-10-01", howFound: "The client told me", whatHappened: "I sent a report to the wrong contact." };

describe("incident validators", () => {
  it("accepts a complete report and treats blank optional fields as missing", () => {
    const r = reportIncidentSchema.parse({ ...base, clientId: "", whoElseKnows: "  ", actionsTaken: "" });
    expect(r.clientId).toBeUndefined();
    expect(r.whoElseKnows).toBeUndefined();
    expect(r.ongoing).toBe(false);
  });
  it("refuses an unknown kind, a bad date and a too short description", () => {
    expect(reportIncidentSchema.safeParse({ ...base, kind: "nope" }).success).toBe(false);
    expect(reportIncidentSchema.safeParse({ ...base, happenedOn: "yesterday" }).success).toBe(false);
    expect(reportIncidentSchema.safeParse({ ...base, whatHappened: "oops" }).success).toBe(false);
  });
  it("limits the text lengths", () => {
    expect(reportIncidentSchema.safeParse({ ...base, whatHappened: "x".repeat(5001) }).success).toBe(false);
    expect(replyIncidentSchema.safeParse({ id: ID, body: "x".repeat(3001) }).success).toBe(false);
  });
  it("closing needs a resolution note", () => {
    expect(setIncidentStatusSchema.safeParse({ id: ID, status: "closed" }).success).toBe(false);
    expect(setIncidentStatusSchema.safeParse({ id: ID, status: "closed", resolution: "Told the client and recalled it." }).success).toBe(true);
    expect(setIncidentStatusSchema.safeParse({ id: ID, status: "in_review" }).success).toBe(true);
  });
  it("normalizes the designation email", () => {
    expect(designatePrivacyOfficerSchema.parse({ email: "  Jo@Example.com ", enabled: true }).email).toBe("jo@example.com");
  });
});

describe("incident constants", () => {
  it("makes a short reference from the id", () => {
    expect(incidentReference(ID)).toBe("PI-11111111");
  });
  it("labels kinds and statuses", () => {
    expect(kindLabel("lost_device")).toMatch(/Lost or stolen/);
    expect(statusLabel("in_review")).toBe("In review");
  });
});

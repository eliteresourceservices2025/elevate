import { describe, expect, it } from "vitest";
import { createInvitationSchema } from "./validators";

describe("createInvitationSchema roles and Safe Voice handler", () => {
  it("defaults to no extra roles and not a handler", () => {
    expect(createInvitationSchema.parse({ email: "New@Example.com" })).toEqual({ email: "new@example.com", roles: [], safevoiceHandler: false });
  });
  it("accepts the grantable roles and the handler flag", () => {
    const parsed = createInvitationSchema.parse({ email: "a@b.co", roles: ["hr_admin", "team_lead"], safevoiceHandler: true });
    expect(parsed.roles).toEqual(["hr_admin", "team_lead"]);
    expect(parsed.safevoiceHandler).toBe(true);
  });
  it("refuses Employee (everyone has it), unknown roles and a non-boolean handler", () => {
    expect(createInvitationSchema.safeParse({ email: "a@b.co", roles: ["employee"] }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "a@b.co", roles: ["root"] }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: "a@b.co", safevoiceHandler: "yes" }).success).toBe(false);
  });
});

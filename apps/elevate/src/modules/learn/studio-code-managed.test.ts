import { describe, expect, it } from "vitest";
import { CODE_MANAGED_COURSES, isCodeManagedCourse } from "./studio-service";

// The core courses are written in the repository and published with the command, not in the Course studio. Client add-ons stay in it.
describe("courses the Course studio does not hold", () => {
  it("lists exactly the three core courses", () => {
    expect([...CODE_MANAGED_COURSES].sort()).toEqual(["customer-service", "cybersecurity", "hipaa"]);
  });
  it("treats a client add-on as editable", () => {
    expect(isCodeManagedCourse("hipaa")).toBe(true);
    expect(isCodeManagedCourse("cybersecurity")).toBe(true);
    expect(isCodeManagedCourse("customer-service")).toBe(true);
    expect(isCodeManagedCourse("client-acme-requirements")).toBe(false);
  });
});

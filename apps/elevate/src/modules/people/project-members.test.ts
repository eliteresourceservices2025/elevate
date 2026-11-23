import { describe, expect, it } from "vitest";
import { keepCurrentPeople } from "./project-members";

const people = [{ id: "a" }, { id: "b" }];

describe("who is ticked when HR opens a project's people list", () => {
  it("keeps the people still assigned to the client", () => {
    expect(keepCurrentPeople(["a", "b"], people)).toEqual(["a", "b"]);
  });
  it("drops someone who left the client, so the list can still be saved", () => {
    expect(keepCurrentPeople(["a", "gone"], people)).toEqual(["a"]);
  });
  it("is empty when nobody is listed", () => {
    expect(keepCurrentPeople(undefined, people)).toEqual([]);
  });
});

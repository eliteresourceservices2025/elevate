import { describe, expect, it } from "vitest";
import { documentOperationResult } from "./operation-result";

describe("document operation feedback", () => {
  const labels = new Map([["failed-file", "Clearance.pdf"]]);
  it("explains an archive's reversible outcome", () => {
    const result = documentOperationResult(
      "archive",
      { done: 5, requested: 5, failed: [] },
      labels,
    );
    expect(result.variant).toBe("success");
    expect(result.description).toContain("5 of 5 documents archived");
    expect(result.description).toContain("can be restored");
  });
  it("does not report partial completion as success and identifies the failed file", () => {
    const result = documentOperationResult(
      "restore",
      {
        done: 2,
        requested: 3,
        failed: [{ documentId: "failed-file", reason: "You cannot restore this file." }],
      },
      labels,
    );
    expect(result.variant).toBe("warning");
    expect(result.description).toContain("2 of 3 documents restored");
    expect(result.details).toEqual(["Clearance.pdf: You cannot restore this file."]);
  });
  it("shows complete failure without exposing an unknown internal id", () => {
    const result = documentOperationResult(
      "delete",
      {
        done: 0,
        requested: 1,
        failed: [{ documentId: "unrecognized-private-id", reason: "The file is not archived." }],
      },
      labels,
    );
    expect(result.variant).toBe("error");
    expect(JSON.stringify(result)).not.toContain("unrecognized-private-id");
    expect(result.details).toEqual(["A selected document: The file is not archived."]);
  });
});

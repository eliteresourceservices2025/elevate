import { describe, expect, it } from "vitest";
import { ASSET_STATUSES, assetPath, assignability, canArchive, canSetStatus, defaultReturnStatus, isValidTag, normalizeTag } from "./constants";
import { DEFAULT_OFFBOARDING_ITEMS, DEFAULT_ONBOARDING_ITEMS } from "@/modules/onboarding/constants";
import { assignAssetSchema, createAssetSchema, listFiltersSchema, returnAssetSchema, setAssetStatusSchema } from "./validators";

const ID = "11111111-1111-4111-8111-111111111111";

describe("tags and addresses", () => {
  it("normalizes to upper case and accepts safe tags only", () => {
    expect(normalizeTag("  ers-lt-0001 ")).toBe("ERS-LT-0001");
    expect(isValidTag("ERS-LT-0001")).toBe(true);
    for (const bad of ["A", "AB", "-ABC", "ABC-", "ERS 01", "ERS/01", "ERS_01", "É-123", "A".repeat(31), "LABELS", "NEW"]) expect(isValidTag(bad)).toBe(false);
  });

  it("the QR path is relative and carries only the tag", () => {
    expect(assetPath("ERS-LT-0001")).toBe("/assets/ERS-LT-0001");
    expect(assetPath("A/B?x")).toBe("/assets/A%2FB%3Fx");
    expect(assetPath("ERS-1").startsWith("//")).toBe(false);
  });
});

describe("assigning", () => {
  it("only an in-stock, not archived item can be assigned", () => {
    expect(assignability({ status: "in_stock", archived: false }).ok).toBe(true);
    for (const status of ASSET_STATUSES.filter((s) => s !== "in_stock")) expect(assignability({ status, archived: false }).ok).toBe(false);
    expect(assignability({ status: "in_stock", archived: true }).ok).toBe(false);
  });

  it("explains why a lost, retired, repaired or already assigned item is refused", () => {
    expect(assignability({ status: "lost", archived: false })).toEqual({ ok: false, reason: "This item is marked lost." });
    expect(assignability({ status: "retired", archived: false })).toEqual({ ok: false, reason: "This item is retired." });
    expect(assignability({ status: "assigned", archived: false })).toMatchObject({ ok: false });
    expect(assignability({ status: "repair", archived: false })).toMatchObject({ ok: false });
  });
});

describe("status changes by hand", () => {
  it("an assigned item cannot be changed by hand and a retired item is final", () => {
    for (const to of ASSET_STATUSES) {
      expect(canSetStatus("assigned", to)).toBe(false);
      expect(canSetStatus("retired", to)).toBe(false);
    }
  });

  it("nothing can be set to assigned by hand", () => {
    for (const from of ASSET_STATUSES) expect(canSetStatus(from, "assigned")).toBe(false);
  });

  it("allows the sensible moves", () => {
    expect(canSetStatus("in_stock", "repair")).toBe(true);
    expect(canSetStatus("repair", "in_stock")).toBe(true);
    expect(canSetStatus("lost", "in_stock")).toBe(true); // found again
    expect(canSetStatus("in_stock", "in_stock")).toBe(false);
  });

  it("an item with someone cannot be archived", () => {
    expect(canArchive({ status: "assigned", archived: false }).ok).toBe(false);
    expect(canArchive({ status: "lost", archived: false }).ok).toBe(true);
    expect(canArchive({ status: "in_stock", archived: true }).ok).toBe(false);
  });

  it("a damaged item defaults to repair on return", () => {
    expect(defaultReturnStatus("damaged")).toBe("repair");
    expect(defaultReturnStatus("good")).toBe("in_stock");
  });
});

describe("validators", () => {
  const base = { tag: "ers-lt-0001", name: "Laptop", category: "laptop" };

  it("creates with a normalized tag and optional fields blank", () => {
    const r = createAssetSchema.parse({ ...base, serialNumber: " ", notes: "", purchaseDate: "" });
    expect(r.tag).toBe("ERS-LT-0001");
    expect(r.serialNumber).toBeUndefined();
    expect(r.purchaseDate).toBeUndefined();
  });

  it("refuses a bad tag, category, name or date", () => {
    expect(createAssetSchema.safeParse({ ...base, tag: "no good" }).success).toBe(false);
    expect(createAssetSchema.safeParse({ ...base, category: "car" }).success).toBe(false);
    expect(createAssetSchema.safeParse({ ...base, name: "x" }).success).toBe(false);
    expect(createAssetSchema.safeParse({ ...base, purchaseDate: "2026-02-31" }).success).toBe(false);
    expect(createAssetSchema.safeParse({ ...base, purchaseDate: "2026-02-28" }).success).toBe(true);
  });

  it("has no field for a price or value", () => {
    const r = createAssetSchema.parse({ ...base, price: 1200, value: 5 } as never);
    expect(Object.keys(r)).not.toContain("price");
    expect(Object.keys(r)).not.toContain("value");
  });

  it("assign and return need a valid condition; return defaults to in stock", () => {
    expect(assignAssetSchema.safeParse({ assetId: ID, employeeId: ID, condition: "broken" }).success).toBe(false);
    expect(assignAssetSchema.safeParse({ assetId: ID, employeeId: ID, condition: "new" }).success).toBe(true);
    expect(returnAssetSchema.parse({ assetId: ID, condition: "fair" }).nextStatus).toBe("in_stock");
    expect(returnAssetSchema.safeParse({ assetId: ID, condition: "fair", nextStatus: "assigned" }).success).toBe(false);
  });

  it("a manual status can be any known status, nothing else", () => {
    expect(setAssetStatusSchema.safeParse({ assetId: ID, status: "lost" }).success).toBe(true);
    expect(setAssetStatusSchema.safeParse({ assetId: ID, status: "stolen" }).success).toBe(false);
  });

  it("filters ignore unknown values by failing the parse", () => {
    expect(listFiltersSchema.safeParse({ status: "in_stock", q: "dell" }).success).toBe(true);
    expect(listFiltersSchema.safeParse({ status: "nope" }).success).toBe(false);
  });
});

describe("checklists", () => {
  it("offboarding ticks equipment by itself; onboarding's equipment task stays manual", () => {
    expect(DEFAULT_OFFBOARDING_ITEMS.find((i) => i.title === "Equipment and assets returned")?.check).toBe("assets_returned");
    expect(DEFAULT_ONBOARDING_ITEMS.find((i) => i.title === "Equipment is ready and issued")?.check).toBe("manual");
  });
});

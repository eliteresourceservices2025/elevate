import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, headerState, nextSort, parseSort, SORT_MENU, SORT_VALUES, sortLines, type SortableLine } from "./sort";

type L = SortableLine & { name: string };
const line = (name: string, clientName: string | null, monthly: string | null, net: string | null, change: string | null, checked = false): L => ({
  runLineId: `id-${name}`,
  name,
  clientName,
  confirmedByName: checked ? "Pia" : null,
  sortKeys: { monthly, net, change },
});

// Arrive in the order the database gives them: last name, first name.
const lines: L[] = [
  line("Alcantara", "Westgate", "2500000", "1250000", "50000", true),
  line("Reyes", "Brightside", "2200000", "1100000", "0"),
  line("Santos", "Brightside", "2800000", "1400000", "-110000"),
  line("Villanueva", null, "1800000", "900000", null),
  line("Zamora", "Westgate", null, null, null, true),
];
const names = (l: L[]) => l.map((x) => x.name);

describe("sortLines", () => {
  it("name A to Z is the order they came in, and Z to A is the reverse of it", () => {
    expect(names(sortLines(lines, "name_asc"))).toEqual(["Alcantara", "Reyes", "Santos", "Villanueva", "Zamora"]);
    expect(names(sortLines(lines, "name_desc"))).toEqual(["Zamora", "Villanueva", "Santos", "Reyes", "Alcantara"]);
  });

  it("client sorts A to Z with No client last, and people in a client keep their name order", () => {
    expect(names(sortLines(lines, "client_asc"))).toEqual(["Reyes", "Santos", "Alcantara", "Zamora", "Villanueva"]);
    expect(names(sortLines(lines, "client_desc"))).toEqual(["Alcantara", "Zamora", "Reyes", "Santos", "Villanueva"]); // still last
  });

  it("monthly rate and total payable sort as numbers, high to low or low to high, with a missing one last either way", () => {
    expect(names(sortLines(lines, "rate_desc"))).toEqual(["Santos", "Alcantara", "Reyes", "Villanueva", "Zamora"]);
    expect(names(sortLines(lines, "rate_asc"))).toEqual(["Villanueva", "Reyes", "Alcantara", "Santos", "Zamora"]);
    expect(names(sortLines(lines, "net_desc"))).toEqual(["Santos", "Alcantara", "Reyes", "Villanueva", "Zamora"]);
    expect(names(sortLines(lines, "net_asc"))).toEqual(["Villanueva", "Reyes", "Alcantara", "Santos", "Zamora"]);
  });

  it("compares large and negative amounts as whole numbers, not text", () => {
    const l = [line("A", null, "9", null, null), line("B", null, "10", null, null), line("C", null, "100000000000000000000", null, null)];
    expect(names(sortLines(l, "rate_desc"))).toEqual(["C", "B", "A"]);
  });

  it("biggest change counts the size of the change, up or down, and no earlier run sorts last", () => {
    expect(names(sortLines(lines, "change_desc"))).toEqual(["Santos", "Alcantara", "Reyes", "Villanueva", "Zamora"]);
    expect(names(sortLines(lines, "change_asc"))).toEqual(["Reyes", "Alcantara", "Santos", "Villanueva", "Zamora"]);
  });

  it("puts the lines nobody has checked first, and the ones that need attention first", () => {
    expect(names(sortLines(lines, "unchecked"))).toEqual(["Reyes", "Santos", "Villanueva", "Alcantara", "Zamora"]);
    const attention = new Set(["id-Santos", "id-Zamora"]);
    expect(names(sortLines(lines, "attention", { attentionIds: attention }))).toEqual(["Santos", "Zamora", "Alcantara", "Reyes", "Villanueva"]);
  });

  it("ties keep the name order they came in", () => {
    const tied = [line("A", "X", "100", "50", "1"), line("B", "X", "100", "50", "1"), line("C", "X", "100", "50", "1")];
    for (const s of SORT_VALUES.filter((v) => v !== "name_desc")) expect(names(sortLines(tied, s))).toEqual(["A", "B", "C"]);
  });

  it("does not change the list it is given", () => {
    const before = names(lines);
    sortLines(lines, "rate_desc");
    expect(names(lines)).toEqual(before);
  });

  it("groups by client first (No client last), then applies the chosen sort inside each client", () => {
    expect(names(sortLines(lines, "rate_desc", {}, { groupByClient: true }))).toEqual(["Santos", "Reyes", "Alcantara", "Zamora", "Villanueva"]);
    expect(names(sortLines(lines, "name_desc", {}, { groupByClient: true }))).toEqual(["Santos", "Reyes", "Zamora", "Alcantara", "Villanueva"]);
    // "Client" while grouped means by name inside each client.
    expect(names(sortLines(lines, "client_asc", {}, { groupByClient: true }))).toEqual(["Reyes", "Santos", "Alcantara", "Zamora", "Villanueva"]);
    expect(names(sortLines(lines, "client_desc", {}, { groupByClient: true }))).toEqual(["Alcantara", "Zamora", "Reyes", "Santos", "Villanueva"]);
  });

  it("keeps a client's people together on every sort when grouped", () => {
    for (const s of SORT_VALUES) {
      const order = sortLines(lines, s, { attentionIds: new Set(["id-Zamora"]) }, { groupByClient: true }).map((x) => x.clientName);
      const firstSeen = [...new Set(order)];
      for (const c of firstSeen) {
        const at = order.map((x, i) => (x === c ? i : -1)).filter((i) => i >= 0);
        expect(at[at.length - 1] - at[0] + 1, `${s}: ${c} is split`).toBe(at.length);
      }
    }
  });
});

describe("parseSort", () => {
  it("accepts a known option and falls back to name A to Z for anything else", () => {
    expect(parseSort("rate_desc")).toBe("rate_desc");
    expect(parseSort("drop table")).toBe(DEFAULT_SORT);
    expect(parseSort(undefined)).toBe("name_asc");
    expect(parseSort(["rate_desc"])).toBe("name_asc");
  });

  it("every option in the menu is a real option", () => {
    for (const s of SORT_MENU) expect(SORT_VALUES).toContain(s);
  });
});

describe("column headers", () => {
  it("a header asks for its first sort, then the opposite one while it is the sort", () => {
    expect(nextSort("name", "rate_desc")).toBe("name_asc");
    expect(nextSort("name", "name_asc")).toBe("name_desc");
    expect(nextSort("name", "name_desc")).toBe("name_asc");
    expect(nextSort("rate", "name_asc")).toBe("rate_desc");
    expect(nextSort("rate", "rate_desc")).toBe("rate_asc");
    expect(nextSort("net", "net_desc")).toBe("net_asc");
    expect(nextSort("checked", "unchecked")).toBe("unchecked");
  });

  it("shows an arrow only on the header that is the sort, pointing the way the list runs", () => {
    expect(headerState("name", "name_asc")).toBe("up");
    expect(headerState("name", "name_desc")).toBe("down");
    expect(headerState("rate", "rate_desc")).toBe("down");
    expect(headerState("rate", "rate_asc")).toBe("up");
    expect(headerState("client", "rate_desc")).toBeNull();
    expect(headerState("checked", "unchecked")).toBe("up");
  });
});

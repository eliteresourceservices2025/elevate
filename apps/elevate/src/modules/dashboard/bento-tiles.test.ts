import { describe, expect, it } from "vitest";
import { arrangeTiles, type TileDef } from "./bento-tiles";

const tile = (id: string): TileDef => ({ id, label: id, span: 2, render: () => null });
const TILES = ["a", "b", "c", "d"].map(tile);
const ids = (tiles: TileDef[]) => tiles.map((t) => t.id);

describe("arrangeTiles", () => {
  it("keeps the default order without a layout", () => {
    expect(ids(arrangeTiles(TILES, null))).toEqual(["a", "b", "c", "d"]);
  });

  it("removes hidden tiles", () => {
    expect(ids(arrangeTiles(TILES, { hidden: ["b", "d"], order: [] }))).toEqual(["a", "c"]);
  });

  it("moves ordered tiles to the front, in that order, and keeps the rest in default order", () => {
    expect(ids(arrangeTiles(TILES, { hidden: [], order: ["c", "a"] }))).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores ids that are not tiles of this view", () => {
    expect(ids(arrangeTiles(TILES, { hidden: ["gone"], order: ["nope", "b"] }))).toEqual(["b", "a", "c", "d"]);
  });

  it("shows a tile once even if the order lists it twice", () => {
    expect(ids(arrangeTiles(TILES, { hidden: [], order: ["b", "b", "a"] }))).toEqual(["b", "a", "c", "d"]);
  });

  it("does not show a tile that is both ordered and hidden", () => {
    expect(ids(arrangeTiles(TILES, { hidden: ["a"], order: ["a", "c"] }))).toEqual(["c", "b", "d"]);
  });
});

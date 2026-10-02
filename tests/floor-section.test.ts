import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FloorBuildUp } from "../src/ui/FloorBuildUp";
import type { Room } from "../src/model/types";

describe("floor section bounds (#6)", () => {
  it.each([-0.2, -0.012, 0, 0.2, undefined])("contains the full stack and datum at substrate level %s", (substrate) => {
    const room: Room = {
      id: "room", x: 0, y: 0, w: 2, h: 3, label: "Bathroom", floor: "tile",
      floorBuildUp: {
        datum: "existing floor",
        substrateTop: { value: substrate, status: substrate === undefined ? undefined : "measured" },
        layers: [
          { id: "s", name: "Screed", kind: "screed", thickness: { value: 0.04, status: "proposed" } },
          { id: "a", name: "Adhesive", kind: "adhesive", thickness: {} },
          { id: "t", name: "Tile", kind: "tile", thickness: { value: 0.02, status: "proposed" } },
        ],
      },
    };
    const svg = renderToStaticMarkup(createElement(FloorBuildUp, { room })).match(/<svg[\s\S]*?<\/svg>/)![0];
    const [, minY, , height] = svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
    for (const rect of svg.matchAll(/<rect\b[^>]*>/g)) {
      const y = Number(rect[0].match(/\by="([^"]+)"/)![1]);
      const h = Number(rect[0].match(/\bheight="([^"]+)"/)![1]);
      expect(y).toBeGreaterThanOrEqual(minY);
      expect(y + h).toBeLessThanOrEqual(minY + height);
    }
    const datum = svg.match(/<line\b[^>]*y1="([^"]+)"/);
    if (substrate === undefined) expect(datum).toBeNull();
    else {
      const y = Number(datum![1]);
      expect(y - 14).toBeGreaterThanOrEqual(minY);
      expect(y).toBeLessThanOrEqual(minY + height);
    }
    expect(svg).toContain("?"); // the unknown adhesive remains visibly unresolved
  });
});

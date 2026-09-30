import { describe, expect, it } from "vitest";
import { tourLayout } from "./tourLayout";

describe("tour card placement", () => {
  it("places the explanation below the highlighted content when it fits", () => {
    const layout = tourLayout({ left: 220, top: 120, right: 1200, bottom: 380 }, { width: 1440, height: 900 }, 250);
    expect(layout.side).toBe("top");
    expect(layout.top).toBeGreaterThan(layout.highlight.top + layout.highlight.height);
  });

  it("moves above a target near the bottom instead of clipping the buttons", () => {
    const layout = tourLayout({ left: 220, top: 550, right: 1200, bottom: 750 }, { width: 1440, height: 800 }, 250);
    expect(layout.side).toBe("bottom");
    expect(layout.top + 250).toBeLessThan(layout.highlight.top);
  });

  it.each([320, 360, 390, 768, 1024, 1440])("keeps long targets and navigation separate at %ipx", (width) => {
    const height = 740;
    const layout = tourLayout({ left: 20, top: 24, right: width - 20, bottom: 1400 }, { width, height }, 276);
    expect(layout.left).toBeGreaterThanOrEqual(16);
    expect(layout.left + layout.width).toBeLessThanOrEqual(width - 16);
    expect(layout.top + 276).toBeLessThanOrEqual(height - 16);
    expect(layout.highlight.top + layout.highlight.height).toBeLessThan(layout.top);
    expect(layout.pointer).toBeGreaterThanOrEqual(24);
    expect(layout.pointer).toBeLessThanOrEqual(layout.width - 24);
  });

  it("keeps a loading card reachable before the destination mounts", () => {
    const layout = tourLayout(null, { width: 320, height: 480 }, 300);
    expect(layout.top).toBeGreaterThanOrEqual(16);
    expect(layout.top + 300).toBeLessThanOrEqual(464);
    expect(layout.highlight).toBeNull();
    expect(layout.side).toBe("none");
  });
});

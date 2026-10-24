import { describe, expect, it } from "vitest";
import { axisTickLabels, formatTime } from "./displayFormat";

describe("axisTickLabels", () => {
  it("does not repeat the day when two bars share it", () => {
    expect(axisTickLabels(["1", "1", "5", "8", "8"])).toEqual(["1", "", "5", "8", ""]);
  });

  it("thins long axes to the visible limit and keeps unique labels", () => {
    const labels = Array.from({ length: 20 }, (_, index) => String(index + 1));
    const ticks = axisTickLabels(labels, 8);
    expect(ticks).toHaveLength(20);
    const visible = ticks.filter(Boolean);
    expect(visible.length).toBeLessThanOrEqual(8);
    expect(new Set(visible).size).toBe(visible.length);
    expect(ticks[0]).toBe("1");
  });

  it("keeps the last tick when it sits far enough from the previous one", () => {
    const labels = Array.from({ length: 13 }, (_, index) => String(index + 1));
    expect(axisTickLabels(labels, 6).at(-1)).toBe("13");
  });
});

describe("formatTime", () => {
  it("uses «a. m.» / «p. m.» in Spanish and «a.m.» / «p.m.» in English", () => {
    expect(formatTime("10:00", "es-MX")).toBe("10:00 a. m.");
    expect(formatTime(0, "es-MX")).toBe("12:00 a. m.");
    expect(formatTime("16:00", "en-MX")).toBe("4:00 p.m.");
  });
});

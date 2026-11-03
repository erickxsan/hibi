import { describe, expect, it } from "vitest";
import { shortMoney } from "./TrackingStudentSheet";

describe("student sheet amounts", () => {
  it("shortens a large debt with its sign, rounding down", () => {
    expect(shortMoney(12_500, "es-MX")).toBe("$12.5k");
    expect(shortMoney(12_599, "es-MX")).toBe("$12.5k");
    expect(shortMoney(10_000, "es-MX")).toBe("$10k");
    expect(shortMoney(1_234_567, "es-MX")).toBe("$1.2M");
  });
});

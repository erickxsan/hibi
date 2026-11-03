// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { preloadableLazy } from "./preloadableLazy.jsx";

const page = (text) => ({ default: ({ label = "" }) => <p>{`${text}${label}`}</p> });

describe("preloadableLazy", () => {
  it("renders a section that was already loaded at once, without «Cargando…»", async () => {
    const loader = vi.fn(async () => page("Seguimiento"));
    const Section = preloadableLazy(loader);
    await Section.load();
    render(
      <Suspense fallback={<p>Cargando…</p>}>
        <Section label=" listo" />
      </Suspense>,
    );
    expect(screen.getByText("Seguimiento listo")).toBeInTheDocument();
    expect(screen.queryByText("Cargando…")).not.toBeInTheDocument();
    // The prefetch and the first visit share one download.
    await Section.load();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("still loads on demand when the prefetch has not run", async () => {
    const Section = preloadableLazy(async () => page("Clases"));
    render(
      <Suspense fallback={<p>Cargando…</p>}>
        <Section />
      </Suspense>,
    );
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    expect(await screen.findByText("Clases")).toBeInTheDocument();
  });

  it("tries a failed chunk again on the next load", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(page("Inicio"));
    const Section = preloadableLazy(loader);
    await expect(Section.load()).rejects.toThrow("offline");
    await Section.load();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

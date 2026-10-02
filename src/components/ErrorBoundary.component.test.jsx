// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { lazy, Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

describe("view failure recovery", () => {
  it("catches a rejected route import and offers recovery instead of a blank screen", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const FailedRoute = lazy(() => Promise.reject(new Error("Synthetic chunk failure")));
    render(
      <ErrorBoundary canReload>
        <Suspense fallback={<p>Loading</p>}>
          <FailedRoute />
        </Suspense>
      </ErrorBoundary>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("This view could not be loaded");
    expect(screen.getByRole("button", { name: "Reload application" })).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith("hibi_render_failure");
    log.mockRestore();
  });
  it("recovers without replacing the retained workspace or offering reload with pending edits", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const workspace = { name: "Retained draft" };
    function View() {
      if (fail) throw new Error("Synthetic rendering failure");
      return <p>{workspace.name}</p>;
    }
    render(
      <ErrorBoundary canReload={false}>
        <View />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This view could not be loaded");
    expect(screen.queryByRole("button", { name: "Reload application" })).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Retained draft")).toBeInTheDocument();
    log.mockRestore();
  });
});

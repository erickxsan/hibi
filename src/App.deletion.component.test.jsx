// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "./App.jsx";

vi.mock("./cloud/client", () => ({
  isCloudConfigured: true,
  isLocalModeAllowed: false,
  cloudAuth: { getSession: () => new Promise(() => {}), onAuthStateChange: () => () => {} },
}));
vi.mock("./cloud/accountDeletionReceiptStore.js", () => ({
  pendingAccountDeletionStore: { getPending: () => ({ ownerId: "deleted-owner" }) },
}));
vi.mock("./cloud/AccountDeletionRecovery.jsx", () => ({ default: () => <div>Resume saved deletion</div> }));
vi.mock("./CloudWorkspaceApplication", () => ({ default: () => <div>Workspace encryption</div> }));
vi.mock("./auth", () => ({ AUTH_MODES: {}, AuthScreen: () => <div>Sign in</div> }));
vi.mock("./i18n", () => ({ useI18n: () => ({}) }));
vi.mock("./cloud/CloudStates", () => ({ CloudLoading: () => <div>Loading Auth</div> }));

it("offers the durable deletion before Auth resolves or workspace encryption starts", async () => {
  render(<App />);
  expect(await screen.findByText("Resume saved deletion")).toBeInTheDocument();
  expect(screen.queryByText("Workspace encryption")).not.toBeInTheDocument();
  expect(screen.queryByText("Sign in")).not.toBeInTheDocument();
});

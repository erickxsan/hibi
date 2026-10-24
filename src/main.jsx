import { initAppearance } from "./theme/appearance";
import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import { I18nProvider } from "./i18n";
import "./design-system.css";
import "./components/base-components.css";

// public/theme-boot.js already set the theme before the first paint; this re-applies it (in case that script
// could not run) and starts following OS and cross-tab changes.
initAppearance();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary canReload={false}>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>,
);

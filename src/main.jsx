import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import { I18nProvider } from "./i18n";
import "./styles.css";
import "./design-system.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary canReload={false}>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>,
);

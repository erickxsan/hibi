import { Component } from "react";
import { useI18n } from "../i18n";
function Recovery({ onRetry, canReload }) {
  const { t } = useI18n();
  return (
    <section role="alert" className="empty-state">
      <h1>{t("This view could not be loaded")}</h1>
      <p>{t("Your saved records are still available. Try opening the view again.")}</p>
      <button type="button" className="button button-primary" onClick={onRetry}>
        {t("Try again")}
      </button>
      {canReload ? (
        <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>
          {t("Reload application")}
        </button>
      ) : (
        <p>{t("Resolve or export pending changes before reloading.")}</p>
      )}
    </section>
  );
}
export class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // Deliberately do not log exception messages/stacks: they may contain student data.
  componentDidCatch() {
    console.error("hibi_render_failure");
    this.props.onError?.();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    // A caller that handles the failure itself (`onError`) can replace the recovery screen.
    if (this.props.fallback !== undefined) return this.props.fallback;
    return <Recovery canReload={this.props.canReload !== false} onRetry={() => this.setState({ failed: false })} />;
  }
}

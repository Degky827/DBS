import { Component } from "react";
import { TriangleAlert } from "lucide-react";

// Catches render failures anywhere below the router so a single broken page
// cannot leave the app as a blank screen.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-canvas px-4 py-16">
        <div
          role="alert"
          className="w-full max-w-lg rounded-2xl border border-ink-200 bg-white p-8 shadow-sm"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-danger">
            <TriangleAlert size={20} aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-xl font-extrabold text-midnight">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            This page could not be displayed. Your money and account data are safe,
            and no action was submitted. Reload the page to try again.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
            <a href="/" className="btn-ghost">
              Return to home
            </a>
          </div>
        </div>
      </div>
    );
  }
}

import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: unknown): void {
    console.error("React render failure", error, errorInfo);
  }

  private recover = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <section className="screen" role="alert">
          <h2>Непредвиденная ошибка экрана</h2>
          <p>{this.state.error.message}</p>
          <button type="button" onClick={this.recover}>Повторить</button>
        </section>
      );
    }
    return this.props.children;
  }
}


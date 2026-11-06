import React, { Component, type ReactNode } from "react";
import { color, space, type } from "../design/tokens";
import { Card, SecondaryButton } from "../design/primitives";
import { supportCode } from "./shared";

/**
 * One per page: a rendering bug shows a plain message and a support code the
 * person can copy, instead of a blank screen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; page: string }, { code: string | null }> {
  state = { code: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { code: supportCode(`${String(error)}`) };
  }

  render() {
    if (!this.state.code) return this.props.children;
    return (
      <Card style={{ display: "flex", flexDirection: "column", gap: space[12], maxWidth: 640 }}>
        <span style={{ ...type.heading }}>This page couldn't be shown.</span>
        <span style={{ ...type.body, color: color.textSecondary }}>
          Something went wrong while drawing {this.props.page}. Reload the page; if it keeps happening, share
          support code{" "}
          <span style={{ ...type.mono, color: color.textPrimary, userSelect: "all" }}>{this.state.code}</span>.
        </span>
        <div>
          <SecondaryButton onClick={() => this.setState({ code: null })}>Try again</SecondaryButton>
        </div>
      </Card>
    );
  }
}

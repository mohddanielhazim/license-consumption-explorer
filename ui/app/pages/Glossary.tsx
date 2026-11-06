import React from "react";
import { color, space, type, layout } from "../design/tokens";
import { Answer } from "../design/primitives";
import { GLOSSARY } from "../data/glossary";
import { SHORTCUTS } from "../components/useShortcuts";
import { SHORTCUT_HELP, SOURCE_OF_TRUTH } from "../strings";

export const Glossary = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: space[32], maxWidth: layout.content }}>
    <Answer setup="What the words" conclusion="on these screens mean." lead="Dynatrace's own terms, plus the names of the four checks this app uses." />
    <p style={{ margin: 0, ...type.body, color: color.textSecondary }}>{SOURCE_OF_TRUTH}</p>
    <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: space[16] }}>
      {GLOSSARY.map((g) => (
        <div key={g.term} style={{ display: "flex", flexDirection: "column", gap: space[4], paddingBottom: space[12], borderBottom: `1px solid ${color.line}` }}>
          <dt style={{ ...type.heading }}>{g.term}</dt>
          <dd style={{ margin: 0, ...type.body, color: color.textSecondary }}>{g.meaning}</dd>
        </div>
      ))}
    </dl>
    <section aria-label={SHORTCUT_HELP.title} style={{ display: "flex", flexDirection: "column", gap: space[12] }}>
      <h2 style={{ margin: 0, ...type.title }}>{SHORTCUT_HELP.title}</h2>
      <p style={{ margin: 0, ...type.body, color: color.textSecondary }}>{SHORTCUT_HELP.lead}</p>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: space[24], rowGap: space[8] }}>
        {SHORTCUTS.map((s) => (
          <React.Fragment key={s.keys}>
            <dt style={{ ...type.mono, color: color.textPrimary }}>{s.keys}</dt>
            <dd style={{ margin: 0, ...type.body, color: color.textSecondary }}>{s.label}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  </div>
);

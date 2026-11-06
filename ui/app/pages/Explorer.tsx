import React, { useEffect, useMemo, useState } from "react";

import { Flex } from "@dynatrace/strato-components/layouts";
import {
  Paragraph,
  Text,
} from "@dynatrace/strato-components/typography";
import {
  RunQueryButton,
  type QueryStateType,
} from "@dynatrace/strato-components/buttons";
import { DataTable, convertToColumns } from "@dynatrace/strato-components/tables";
import { DQLEditor } from "@dynatrace/strato-components/editors";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { useDql } from "@dynatrace-sdk/react-hooks";

import { useSearchParams } from "react-router-dom";
import { VIEWS } from "../views";
import { OpenQuery, usePeriod } from "../components/shared";
import { fillPeriod } from "../data/period";
import { SelfCost } from "../components/SelfCost";
import { Answer } from "../design/primitives";
import { color, radius, space, type } from "../design/tokens";

export const Explorer = () => {
  // ?view=<id> opens a specific view, so funnel capability cards can link here.
  const [params] = useSearchParams();
  const initialIndex = Math.max(0, VIEWS.findIndex((v) => v.id === params.get("view")));
  const [viewIndex, setViewIndex] = useState<number>(initialIndex);
  // The header's timeframe, like every other screen (it had its own 7-day buttons before v0.12.12).
  const period = usePeriod();
  // The same time base as every screen: records kept by when the usage happened.
  const timeframe = `${period.fromIso}|${period.toIso}|${period.fetchToIso}`;

  const view = VIEWS[viewIndex];

  const buildQuery = useMemo(
    () => (v: typeof view, tf: string) => {
      const [fromIso, toIso, fetchToIso] = tf.split("|");
      return fillPeriod(v.query, { fromIso, toIso, fetchToIso });
    },
    [],
  );

  // The query currently shown in the editor, and the one actually submitted.
  const [editorQuery, setEditorQuery] = useState<string>(
    buildQuery(VIEWS[initialIndex], timeframe),
  );
  const [submittedQuery, setSubmittedQuery] = useState<string>(
    buildQuery(VIEWS[initialIndex], timeframe),
  );

  // Switching tab or timeframe rewrites the query and re-runs it.
  useEffect(() => {
    const next = buildQuery(view, timeframe);
    setEditorQuery(next);
    setSubmittedQuery(next);
  }, [viewIndex, timeframe, view, buildQuery]);

  const { data, error, isLoading, cancel, refetch } = useDql(
    { query: submittedQuery },
    // Keep running when the tab is hidden (the hook cancels by default, leaving no answer).
    { runInBackground: true },
  );

  function onRun() {
    if (isLoading) {
      void cancel();
    } else if (submittedQuery !== editorQuery) {
      setSubmittedQuery(editorQuery);
    } else {
      void refetch();
    }
  }

  let queryState: QueryStateType = "idle";
  if (error) queryState = "error";
  else if (isLoading) queryState = "loading";
  else if (data) queryState = "success";

  const columns = useMemo(
    () => (data?.types ? convertToColumns(data.types) : []),
    [data],
  );

  const rowCount = data?.records?.length ?? 0;


  // Detail panel: a raised surface set apart from the tab strip by 32px of space; no border
  // (one card style everywhere; the table inside already has its own lines).
  const panel = (
    <section
      aria-labelledby="diag-view-title"
      style={{
        marginTop: space[32],
        background: color.surface1,
        borderRadius: radius.surface,
        padding: space[24],
        display: "flex",
        flexDirection: "column",
        gap: space[16],
      }}
    >
      <h2 id="diag-view-title" style={{ ...type.title, color: color.textPrimary, margin: 0 }}>
        {view.label}
      </h2>
      <span style={{ ...type.body, color: color.textSecondary }}>{view.blurb}</span>

      <DQLEditor value={editorQuery} onChange={(value) => setEditorQuery(value)} />

      <Flex justifyContent={error ? "space-between" : "flex-end"} gap={8}>
        {error && (
          <Flex alignItems="center" gap={4} role="alert" style={{ color: color.signal }}>
            <Paragraph>{error.message}</Paragraph>
          </Flex>
        )}
        <Flex gap={8} alignItems="center">
          <OpenQuery query={editorQuery} />
          <RunQueryButton onClick={onRun} queryState={queryState} />
        </Flex>
      </Flex>

      {isLoading && (
        <Flex justifyContent="center" padding={24}>
          <ProgressCircle aria-label="Loading results" />
        </Flex>
      )}

      {!isLoading && data?.records && (
        <Flex flexDirection="column" gap={8}>
          <Text>
            {rowCount} {rowCount === 1 ? "row" : "rows"}
          </Text>
          <DataTable data={data.records} columns={columns} sortable resizable>
            <DataTable.Pagination defaultPageSize={50} />
            <DataTable.EmptyState>
              No billing records matched. Open the Raw records tab and confirm
              the field names for this capability in your environment.
            </DataTable.EmptyState>
          </DataTable>
        </Flex>
      )}
    </section>
  );

  return (
    <Flex flexDirection="column" gap={16}>
      <Flex flexDirection="column" gap={4}>
        <Answer setup="Diagnostics:" conclusion="the raw billing records behind every screen." />
        <Paragraph>
          Every table below is built from Dynatrace billing usage events, the same records every screen reads.
          Nothing here needs cost centres.
        </Paragraph>
      </Flex>


      <Tabs
        selectedIndex={viewIndex}
        onChange={(index: number) => setViewIndex(index)}
        panelOverflow="scroll-y"
      >
        {VIEWS.map((v, i) => (
          <Tab key={v.id} title={v.label}>
            {i === viewIndex ? panel : null}
          </Tab>
        ))}
      </Tabs>
      {/* What this app's own queries cost: useful, but not the answer, so it sits at the foot. */}
      <SelfCost />
    </Flex>
  );
};

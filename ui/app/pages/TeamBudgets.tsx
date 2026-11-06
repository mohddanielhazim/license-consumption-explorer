import React from "react";

import { space } from "../design/tokens";
import { Answer } from "../design/primitives";
import { DataAsOf, QueryOutcome, ShowQuery, Bone, usePeriod } from "../components/shared";
import { PriceTag } from "../components/Tags";
import { usePref } from "../data/prefs";
import { useOwnerRules } from "../data/ownership";
import { formatCost, useAmSnapshot } from "../rates";
import { AmAllocation } from "../components/AmFacts";
import { R } from "../routes";
import { BUDGETS, Teams, useOwnershipData } from "./Ownership";

import { NextSteps } from "../components/NextSteps";
/**
 * Team budgets (Cost workspace, v0.10.0): the "Owners and budgets" section of
 * the Ownership screen, moved here unchanged. Owners follow the saved rules;
 * rules are edited on the Consumption workspace's Ownership screen.
 */
export const TeamBudgets = () => {
  const { value: rules } = useOwnerRules();
  const budgets = usePref(BUDGETS);
  const period = usePeriod();
  const { rates, discovery, hosts, namespaces, ents, owned, teams, last, sources, loading, failing } = useOwnershipData(rules);
  const ownedCost = owned.reduce((a, e) => a + (e.cost ?? 0), 0);
  const snap = useAmSnapshot().value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[32] }}>
      <QueryOutcome
        query={failing.query}
        records={discovery.error || hosts.error || namespaces.error ? undefined : loading ? undefined : [...(hosts.records ?? []), ...(namespaces.records ?? [])]}
        error={discovery.error ?? hosts.error ?? namespaces.error}
        errorKind={hosts.errorKind ?? namespaces.errorKind}
        isLoading={loading}
        retry={failing.retry} cancel={failing.cancel} cancelled={failing.cancelled}
        empty={`No billing records named a host or a namespace in ${period.phrase}.`}
        skeleton={<Bone w="70%" h={38} />}
      >
        <Answer
          setup={teams.length ? `${teams.length} ${teams.length === 1 ? "owner" : "owners"}` : "No owners"}
          conclusion={teams.length ? `account for ${formatCost(ownedCost, rates.currency)} in ${period.phrase}.` : "yet, so there is nothing to budget."}
          lead={`Cost per owner of the billed hosts and namespaces, from Dynatrace cost centres or your ownership rules. ${owned.length} of ${ents.length} hosts and namespaces have an owner.`}
        />
        <span style={{ display: "flex", gap: space[12], alignItems: "center", flexWrap: "wrap" }}>
          <PriceTag sources={sources} />
          <DataAsOf last={last} />
        </span>
        <Teams teams={teams} rates={rates} days={(Date.parse(period.toIso) - Date.parse(period.fromIso)) / 86400000} budgets={budgets} sources={sources} />
      </QueryOutcome>
      {rates.contract && <AmAllocation snap={snap} currency={rates.contract.currency} />}
      <NextSteps links={[{ to: R.ownership, label: "Add or change owners" }]} />
      <ShowQuery query={`${hosts.query}\n\n${namespaces.query}`} />
    </div>
  );
};

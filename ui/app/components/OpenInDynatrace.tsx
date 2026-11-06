import React from "react";
import { sendIntent } from "@dynatrace-sdk/navigation";

import { SecondaryButton } from "../design/primitives";

/**
 * rule 10): the platform picks the app that accepts this entity type, so no app
 * URL is hard-coded here. `field` is the entity's intent property, e.g.
 * "dt.entity.host" for a host.
 */
export function OpenInDynatrace({ field, id, label = "Open in Dynatrace" }: { field: string; id: string; label?: string }) {
  return <SecondaryButton onClick={() => sendIntent({ [field]: id })}>{label}</SecondaryButton>;
}

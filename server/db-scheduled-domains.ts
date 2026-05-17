// Scheduled-refresh domain reader (v0.52.0).
//
// Single source of truth for "which domains should the background loop keep
// warm": the distinct `stores.domain` values that already carry provenance
// for a given provider source. No new config surface — the scheduler refreshes
// exactly what the import path has previously tracked for that source.
//
// Visibility-only: this module executes a single SELECT. It performs NO
// INSERT/UPDATE/DELETE and never reads payloads, headers, env, DB paths, or
// secrets. `source_id` is a column on `coupon_code_sources` (db.ts), so no
// `coupon_sources` join is needed here; `canFetchSourceNow` independently
// handles the `unknown_source` case at the gate.

import type { Db } from "./db";
import { validateSourceId } from "./db-sources";

export function listProviderProvenanceDomains(
  db: Db,
  sourceId: string,
): string[] {
  const id = validateSourceId(sourceId);
  const rows = db
    .prepare(
      `SELECT DISTINCT s.domain AS domain
         FROM stores s
         JOIN coupon_code_sources ccs ON ccs.store_id = s.id
        WHERE ccs.source_id = ?
        ORDER BY s.domain ASC`,
    )
    .all(id) as Array<{ domain: string }>;
  return rows.map((r) => r.domain);
}

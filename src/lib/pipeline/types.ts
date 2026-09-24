// The four pipeline layers — see SPEC.md "Four-layer modular pipeline"
// (cross-cutting decision #3). Deliberately generic/abstract here;
// concrete shapes (JurisdictionAdapter, the real aggregator, Stage 9/10's
// processors, Stage 6's presenters) implement these as each stage lands.

import type { collectorTypeEnum } from "@/db/schema";

export type CollectorType = (typeof collectorTypeEnum.enumValues)[number];

/**
 * The verbatim source a batch of records was parsed from — everything
 * `createCollectedItem` needs (besides who collected it) to write the
 * `CollectedItem` provenance row every government-record row's
 * `source_item` points at. `rawPayload` is the original response text,
 * never a re-serialized object (see SPEC.md "Provenance envelope").
 */
export interface SourceSnapshot {
  sourceUrl: string;
  contentType: string;
  rawPayload: string;
  sourceTimestamp?: string; // ISO timestamp, when the source says it was published
}

/**
 * One fetch's output: the records parsed out of it, plus the snapshot they
 * came from. Collectors never touch the database — the aggregator writes
 * one `CollectedItem` per `Collected` batch and stamps every record in it
 * with that row's id as its `source_item`. Collectors return one batch per
 * underlying HTTP response/upload/feed item.
 */
export interface Collected<T> {
  snapshot: SourceSnapshot;
  records: T[];
}

/**
 * Fetches raw data from one source. `JurisdictionAdapter` (see
 * jurisdiction-adapter.ts) is the concrete shape of this for
 * government-API collectors specifically; Stage 8's RSS/GDELT/oEmbed
 * integrations are collectors of the same kind for news and social
 * sources.
 */
export interface Collector<TOutput = unknown> {
  readonly collectorId: string;
  readonly collectorType: CollectorType;
  collect(): Promise<Collected<TOutput>[]>;
}

/**
 * Merges whatever a Collector returns into the core data model,
 * regardless of which collector or source format it came from. Real
 * implementation is service-layer functions (see services/), not a
 * class — this interface exists so the contract is explicit and typed.
 */
export interface Aggregator<TInput = unknown> {
  aggregate(batches: Collected<TInput>[]): Promise<void>;
}

/**
 * Takes aggregated data and distills it into derived information —
 * issue-area tagging, entity resolution, claim extraction, etc. Each
 * processor is a self-contained module, not one monolithic transform
 * step. First real implementations land in Stage 9/10.
 */
export interface Processor<TInput = unknown, TOutput = unknown> {
  readonly processorId: string;
  process(input: TInput): Promise<TOutput>;
}

/**
 * Renders processor output as a digestible, honest view with links back
 * to primary sources — a radar chart, a scorecard, a leaderboard. First
 * real implementations land in Stage 6; this is a placeholder contract
 * until then, without a props type param yet since nothing implements
 * it — Stage 6 adds that when there's a real render contract to type.
 */
export interface Presenter {
  readonly presenterId: string;
  readonly title: string;
}

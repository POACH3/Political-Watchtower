// Stage 1 scope only — government-records schema. The narrative/oversight
// half (Claim, Promise, NewsItem, ReviewAction, SuppressionRule, ...) is
// Stage 2, deliberately kept out of this migration; see SPEC.md
// "Staging notes" for why the schema is split this way.

export * from "./collected-items";
export * from "./jurisdictions";
export * from "./people";
export * from "./legislation";
export * from "./votes";

# Plan Review Log: P1a multimodal pricing core
Started 2026-10-21 (session). MAX_ROUNDS=3. Reviewer: Codex (gpt-5.6-sol), read-only. Plan: docs/specs/2026-10-21-p1a-multimodal-core.md

## Round 1 — Codex

The plan is not implementation-ready. The following are material correctness, security, and rollout defects.

1. **Mixed-equipment FCL cannot be matched correctly.** The request explicitly allows mixed equipment, but matching selects one top `RateLine` per carrier, so a carrier’s separate 20GP and 40HC lines cannot form one option ([spec](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/docs/specs/2026-10-21-p1a-multimodal-core.md:87)).  
Fix: Match independently per requested equipment type, require a complete compatible set for each carrier, then compose those lines into one option.

2. **Door services can silently receive port-to-port pricing.** `service` is extracted but absent from tariff matching and FCL completeness, despite door composition being deferred.  
Fix: In P1a accept only `PORT_TO_PORT` for FCL/LCL and escalate every other service until composition exists.

3. **Customer-specific matching has no trusted customer identity.** `RateLine.customer` and margin customer matching exist, but `ShipmentRequest` has only model-extracted company text and no verified customer ID; using sender domains permits spoofed preferential pricing.  
Fix: Resolve a trusted tenant-scoped `customer_id` from authenticated CRM/mailbox data, and disable customer-specific matching when it is unavailable.

4. **The specificity tuple is underspecified and order-biased.** A lexicographic `(origin,destination,customer,equipment)` comparison can make origin specificity dominate every other dimension, while a summed score creates different ambiguity.  
Fix: Define an explicit partial-order or documented weighted rank, including incomparable matches and deterministic tie behavior, with exhaustive tests.

5. **Validity uses the wrong pricing date.** Candidates match `asOf`, then separately reject a ready date after expiry; rates normally need to cover a defined booking, sailing, or cargo-ready date, not merely today.  
Fix: Define one `pricing_date` policy per tariff/service and use it consistently for matching, validity, option expiry, and receipts.

6. **Dangerous goods and reefer requests can be quoted as ordinary cargo.** The fields exist, but neither completeness nor tariff conditions require corresponding equipment or surcharges.  
Fix: Fail closed on DG, temperature-controlled, or other special-cargo flags unless an explicitly matching tariff condition prices them.

7. **LCL cargo semantics are ambiguous.** `pieces[].weight_kg` does not say whether weight is per piece or total, and conflicts between piece-derived and stated totals have no deterministic rule.  
Fix: Name per-piece fields explicitly, derive totals in code, and escalate when supplied totals differ beyond a documented tolerance.

8. **Chargeable-quantity precision is unspecified.** The plan defines monetary rounding but not W/M precision, unit-conversion precision, or whether minimums apply before or after W/M rounding.  
Fix: Specify canonical quantity scales and the exact sequence `normalize → aggregate → chargeable-unit round → multiply → monetary round → clamp`.

9. **The “no binary floats” invariant stops at money.** Dimensions and weights appear as ordinary JSON numbers, so unit normalization can introduce binary error before multiplication by an exact rate.  
Fix: Transport all price-affecting quantities as bounded decimal strings and parse them into `Decimal` before arithmetic.

10. **The proposed `Decimal` API cannot perform general FX conversion.** It lists multiplication but no exact/rational division, while base-relative FX rates require division for at least one direction.  
Fix: Define rate direction explicitly and add bounded rational division with a specified rounding scale, or adopt a proven arbitrary-precision decimal library.

11. **FX behavior is incomplete.** Missing, zero, negative, duplicate, future, or stale rates; same-currency conversion; inverse rates; and multiple source currencies are unspecified.  
Fix: Validate snapshots strictly, define maximum age and direction, require every currency pair, and store one conversion receipt per source subtotal.

12. **`FxUsed` cannot audit a multi-currency option.** A singular optional field cannot represent separate USD, SGD, and local-currency conversions.  
Fix: Replace it with an ordered `FxConversion[]` containing source/target, input minor amount, rate, output minor amount, source, timestamp, and rounding.

13. **Margin semantics are financially ambiguous.** `PERCENT` could mean markup on cost or gross-margin percentage, while `PER_UNIT`, `FLAT`, and minimum values have no currency or unit.  
Fix: Split percent kinds into `MARKUP_ON_BUY` and `GROSS_MARGIN`, and attach explicit currency and basis to every non-percent value and floor.

14. **Minimum-margin allocation is unsafe.** “Top up the main freight line” fails when there are multiple freight lines, currencies, or no uniquely designated freight line and distorts the source charge.  
Fix: Emit a separate sell-only margin adjustment line in a declared currency instead of mutating an arbitrary freight line.

15. **Percentage charges can reference ambiguous or cross-currency codes.** Charge codes are not declared unique, while `PCT_OF` cannot legally sum rounded lines in different currencies.  
Fix: Require stable unique charge IDs, validate dependency DAGs, and reject percentage bases spanning currencies unless an explicit pre-percentage FX policy exists.

16. **Negative amounts, rebates, and overflow are undefined.** `bigint` is unbounded in core but PostgreSQL `bigint` is not, and tariffs may contain credits or pathological decimal scales.  
Fix: Define allowed signs and enforce bounded coefficient, scale, quantity, line count, and final-minor ranges before pricing or persistence.

17. **Option ordering is nondeterministic on equal totals.** Sorting only by converted sell total can change the selected top three based on source iteration order.  
Fix: Add stable tie-breakers such as carrier, tariff ID/version, and canonical option ID before truncation.

18. **Discarded options are not auditable.** Applying `max_options` after sorting loses evidence that other matched rates existed or why they were excluded.  
Fix: Persist candidate counts and exclusion reasons, or retain all option receipts internally while exposing only the configured number.

19. **“Buy hidden” is only cosmetic.** The dashboard currently reads the entire `breakdown_snapshot` through tenant-visible RLS ([dashboard query](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/apps/web/src/lib/dashboard.ts:111)); any browser user can inspect v2 `buy` values even if React does not render them.  
Fix: Store costs separately behind privileged access or expose a sell-only database view/RPC to browser roles.

20. **The draft money guard is bypassable.** “Currency adjacent to digits” permits bare totals, words such as “six thousand euros,” separated symbols, or misleading percentages, so drift is not impossible as claimed.  
Fix: Give the model no pricing values and use deterministic prose around slots, or reject every numeric token and money word outside a strict slot allowlist.

21. **Rendered slots introduce an output-injection surface.** Carrier names, descriptions, source references, and other tariff text may reach HTML/email without an escaping requirement.  
Fix: Context-escape every inserted field and allowlist displayable charge codes/descriptions before rendering HTML or text.

22. **BigInt boundary handling is not designed.** Core `Money` contains `bigint`, but canary scanning, deep equality, persistence, and JSON cassettes all require serialization; the current guard uses `JSON.stringify` ([guard](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/packages/agents/src/injection-guard.ts:49)).  
Fix: Define one canonical wire schema using decimal strings and convert to it before comparison, scanning, hashing, logging, or persistence.

23. **The new escalation reason will violate the database constraint.** `rate_validity_short` is introduced by the gate, but the current allowed taxonomy omits it ([migration](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/supabase/migrations/0018_llm_failure_reasons_and_default_grants.sql:10)).  
Fix: Include every v2 reason in the schema, Zod contract, database constraint, dashboard labels, evals, and requeue tests in the same migration.

24. **Named missing fields are not persisted.** The plan says escalations carry `missing_fields[]`, but persistence stores only the reason and extraction; the RPC has no outcome-detail argument ([RPC](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/supabase/migrations/0020_audit_fidelity.sql:62)).  
Fix: Add a validated `outcome_detail` JSON column/argument and expose its named fields in audit and review views.

25. **The migration lacks a concrete v1 discriminator and constraints.** Existing rows need `quote_version=1`, while v2 rows need mutually consistent currency, total, option count, and snapshot shape.  
Fix: Use an expand migration with `quote_version NOT NULL DEFAULT 1`, version-specific checks, ISO currency checks, positive option counts, and validated v2 insertion.

26. **The existing persistence RPC cannot accept the proposed shape.** It still extracts v1 keys and casts `all_in_total` to `int` ([RPC mapping](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/supabase/migrations/0020_audit_fidelity.sql:91)); merely saying it “maps both versions” is insufficient.  
Fix: Specify and test exact v1/v2 JSON branches, bigint bounds, rollback behavior, grants, function signatures, and old-client compatibility.

27. **The deployment order violates “each task green.”** AgentOutput v2 is wired in task 10, while database, worker persistence, dashboard, evals, and cassette updates wait until tasks 11–12.  
Fix: Introduce additive dual-read/dual-write compatibility first, deploy the migration before v2 producers, then switch consumers and finally remove v1 paths.

28. **Legacy parity ignores margin classification.** Existing rate-card amounts are already customer-facing sell rates; applying a default margin would break the promised identical totals.  
Fix: Mark legacy adapter lines explicitly as sell-only or apply a mandatory zero-margin legacy policy and test every line, not only the total.

29. **The tariff snapshot can still be torn.** The production adapter currently reads a card and its lines in separate calls, and “same tariffs/context” is not guaranteed if an import changes lines between them.  
Fix: Fetch an immutable tariff version atomically through one RPC/transaction and include a content hash in every pricing receipt.

30. **The current claim operation permits concurrent runs.** A request already in `processing` is claimable again ([store](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/packages/ingest/src/supabase-store.ts:80)), so duplicate workers can both spend tokens and produce divergent outcomes.  
Fix: Claim only `received` or an expired lease using an attempt token, and require that same token when persisting the outcome.

31. **The six-tenant “operational end to end” goal contradicts the runtime scope.** The poller is explicitly single-tenant ([poller](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/packages/trigger/src/trigger/poll.ts:40)), while mock tariffs are wired only to CLI/demo and multi-tenant runtime is deferred.  
Fix: Narrow the exit criterion to one production tenant plus six offline demos, or include tenant mailbox/config iteration and tenant-scoped tariff/margin configuration now.

32. **Several existing consumers are omitted from the transition plan.** CLI formatting is hard-coded to one container and EUR ([CLI formatter](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/apps/cli/src/format.ts:18)), and RAG query construction assumes the v1 quote shape.  
Fix: Inventory and update CLI, ingest, Trigger worker, retriever, guards, exports, score logic, web pages, SQL tests, and live evals as explicit migration tasks.

33. **Cassette updates occur too late.** Extraction/draft prompt changes alter replay keys immediately, so demo and CI will fail between task 10 and task 12.  
Fix: Update or version replay cassettes in the same commit as each prompt/schema change and retain v1 cassettes until all consumers migrate.

34. **Observability does not cover pricing decisions.** Receipts in the snapshot do not produce operational metrics for no-rate causes, ambiguity, FX age, margin rule selection, truncation, or guard differences.  
Fix: Emit structured tenant-safe audit events and counters containing tariff/version IDs, outcome reason, candidate counts, FX age, margin rule IDs, and guard violation types.

35. **The custom arithmetic scope is unnecessarily risky.** A home-grown decimal implementation, currency table, graph evaluator, FX converter, and serializer substantially enlarges the correctness burden.  
Fix: Keep `Money` as minor-unit bigint but use a mature decimal library for quantities/rates and a small explicit currency allowlist covered by conformance vectors.

VERDICT: REVISE

### Claude's response
All 35 findings accepted. Scope notes: #31 exit criterion narrowed (production worker single-tenant via legacy adapter until P3; six tenants via CLI/demo/evals); #34 partially deferred (trace + outcome_detail now, counters/alerts P7); #3 customer-specific pricing removed from P1a until P3 identity; #35 adopt big.js for decimal math (Money stays bigint minor units); #6 DG/reefer null treated as general cargo (assumption logged). Spec rewritten as Round 1 revision.

## Round 2 — Codex

The R1 plan closes most prior findings, but several material correctness, security, and retry defects remain.

1. **Price-affecting LLM values still pass through JavaScript numbers.** `String(n)` cannot recover digits already rounded by JSON parsing and therefore does not satisfy exact-decimal transport.  
Fix: Require decimal strings directly in the extraction schema and reject JSON numbers for every price-affecting quantity.

2. **The unit schema is internally inconsistent.** Fields are named `length_cm_each` and `weight_kg_each`, yet separate `unit_length` and `unit_weight` fields imply those values are not normalized, and one global unit cannot represent mixed-unit pieces.  
Fix: Represent each raw measurement as `{ value: decimal-string, unit }`, then produce separate normalized fields in code.

3. **Resource-exhaustion bounds are still missing.** Big.js precision, decimal scale, string length, piece/container counts, tariff lines, charges, carriers, and generated candidate counts remain unbounded.  
Fix: Define hard limits for every collection and decimal representation and reject oversized requests or tariffs before arithmetic and option construction.

4. **Unknown DG status still fails open.** Treating `dangerous_goods=null` as general cargo may omit safety-related surcharges and restrictions without telling the customer.  
Fix: Either require an explicit DG declaration or include a deterministic, customer-visible “non-dangerous general cargo” assumption in every affected quote and draft.

5. **Mixed-equipment shipment fees are selected arbitrarily.** Taking `PER_SHIPMENT` and `PER_BL` charges from the “first equipment line” can silently choose different fees when equipment lines disagree.  
Fix: Require shipment-level charges to be identical across all component lines or model them once at tariff/offer level; otherwise reject the option as inconsistent.

6. **Lines can be combined into a commercially invalid option.** Grouping only by carrier permits 20GP and 40HC lines from unrelated tariffs, contracts, services, or offers to be merged.  
Fix: Add a stable `offer_group_id` or compatibility key and permit mixed-equipment composition only within the same compatible offer.

7. **Priority semantics remain incomplete.** The plan does not state whether higher or lower values win or precisely how priority interacts with multiple incomparable non-dominated lines.  
Fix: Define an exact algorithm—compute the non-dominated set, retain the declared highest priority, and require exactly one remaining line—with deterministic tests.

8. **`applies_to: FREIGHT` cannot be evaluated.** `ChargeDef` has no charge category identifying freight, so the margin engine would have to infer it from uncontrolled codes.  
Fix: Add a validated `category: FREIGHT | SURCHARGE | LOCAL | DOCUMENT | MARGIN` field and match margin scope only against that enum.

9. **`FLAT` margin behavior is unspecified.** The plan explains percent margins but not whether a flat amount applies per line, equipment, leg, or shipment, nor how it interacts with `FREIGHT | ALL`.  
Fix: Define FLAT as one shipment-level adjustment in its declared currency and specify its ordering relative to percentage margins and minimum margin.

10. **Gross-margin validation and mixed-currency minimums are undefined.** `GROSS_MARGIN >= 1` is mathematically invalid, and comparing a `min_margin` with margins earned in several currencies requires an FX/order policy.  
Fix: Constrain margin values by kind and calculate the minimum-margin test after converting buy and sell subtotals to quote currency using the recorded FX conversions.

11. **FX still performs an avoidable intermediate rounding.** Rounding a cross-rate to 12 decimal places and then rounding money can produce a different result from a single final monetary rounding, especially near the allowed amount bound.  
Fix: Perform the base-rate division at sufficient unrounded Big.js precision and round only the final target-money result, with conformance vectors.

12. **FX validation still omits future and missing-rate behavior.** A future-dated snapshot can pass the seven-day age check, and the result for a missing source or target currency is unspecified.  
Fix: Require `0 ≤ as_of_age ≤ 7 days` relative to the pricing context and return a named unpriceable result for every missing conversion rate.

13. **FX gating is overbroad unless made conditional.** A stale or absent snapshot should not reject a quote whose charges already use the quote currency.  
Fix: Validate freshness and required rates only when at least one non-identity conversion is actually needed.

14. **Option validity ignores parts of the effective tariff interval.** `valid_until` references one optional line date although mixed options can contain several lines plus tariff-level validity.  
Fix: Set validity to the minimum of every component line’s effective end, every parent tariff end, and the tenant quote-validity limit.

15. **The guard compares only `candidates`.** Tampering or bugs in `presented`, option ordering, trace, or selected quote totals can survive while the candidate array remains identical.  
Fix: Compare the complete canonical `PricingResult`, excluding only explicitly documented volatile metadata.

16. **The canary scan’s scope is ambiguous and appears too narrow.** Scanning the pricing wire does not detect a canary leaked into the LLM template, rendered draft, extraction notes, or final `AgentOutput`.  
Fix: Scan the canonical final output—including extraction, templates, rendered draft, pricing result, and outcome detail—before persistence.

17. **The ten-minute lease conflicts with the one-hour worker limit.** A healthy long run can lose its lease and have its valid result rejected while another worker duplicates the LLM spend ([Trigger configuration](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/packages/trigger/trigger.config.ts:19)).  
Fix: Add lease heartbeats or set the lease beyond maximum execution duration while still supporting explicit stale-run recovery.

18. **Normal Trigger retries will strand requests under the proposed lease.** After an infrastructure failure, the retry occurs within seconds, cannot claim the unexpired `processing` row, returns `not_claimable` successfully, and prevents `onFailure` recovery.  
Fix: Use a stable execution-owner token so retries of the same durable run can reacquire their own lease while unrelated executions must wait for expiry.

19. **`markError` is not protected by the attempt token.** An old attempt’s failure hook can mark a newer attempt’s still-processing request as `error`; the current hook updates by tenant/request only ([worker](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/packages/trigger/src/trigger/run.ts:43)).  
Fix: Require the active attempt token for `markError` and every other processing-to-terminal transition.

20. **The sell-only public snapshot is not actually specified.** `QuoteView` is named but has no schema showing exactly which presented options, receipts, totals, and trace fields enter `quotes.breakdown_snapshot`, making accidental buy-data persistence likely.  
Fix: Define and validate a concrete `QuoteViewV2` wire schema and construct it by allowlisting fields rather than deleting sensitive fields from `PricingResult`.

21. **`outcome_detail` can become a second confidentiality leak.** Its “trace summary” is undefined while trace contains rate-line and margin-rule information, and request rows are browser-readable.  
Fix: Define a separate public outcome-detail schema that excludes buy values, margin identifiers, source references, and unpresented candidates.

22. **`quote_internals` hardening is underspecified for this repository.** New public-schema tables can inherit browser grants, and merely saying “service_role only” previously proved insufficient in this codebase ([existing hardening](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/supabase/migrations/0015_audit_hardening.sql:15)).  
Fix: Explicitly revoke all privileges from PUBLIC/anon/authenticated, enable RLS, grant only required service-role privileges, and add SQL privilege tests.

23. **Tenant consistency is not database-enforced for internals.** A `request_id` and independently supplied `tenant_id` can disagree inside a SECURITY DEFINER persistence function.  
Fix: derive the tenant from the claimed request or enforce a composite foreign key and verify it before inserting quotes, drafts, and internals.

24. **The draft denylist is not a structural guarantee.** Phrases such as “complimentary,” “at no charge,” or untranslated money expressions can invent commercial terms without digits or listed money words.  
Fix: Use tenant-owned deterministic templates with slots, or restrict model output to a tightly allowlisted set of non-commercial phrases.

25. **The tariff content hash can be stale unless its derivation is specified.** A stored hash does not prove that the atomically returned card and lines are the bytes that were hashed.  
Fix: Canonically order and serialize the rows returned by the atomic RPC, then compute or verify the content hash from that exact snapshot before pricing.

VERDICT: REVISE

### Claude's response
All 25 accepted; consolidated as spec §15 (overrides earlier text). #24 accepted partially: commercial terms fully code-rendered from tenant templates; model limited to greeting/intro/closing with digit, money-word and commitment-phrase denylists; residual risk documented, human approval mandatory in P1a.

## Round 3 — Codex

Section 15 resolves most earlier findings, but several material gaps remain.

1. **Expired processing leases are never rediscovered.** The poller only re-enqueues `received` rows, so a run abandoned without retries or `onFailure` will remain `processing` forever even after 70 minutes ([poll logic](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/packages/ingest/src/poll.ts:84)).  
Fix: Have the scheduled recovery query and enqueue expired `processing` rows as well as stranded `received` rows.

2. **Requeue lifecycle for new state is unspecified.** Existing requeue logic deletes quotes/drafts but would leave `quote_internals`, `outcome_detail`, lease owner, and claim timestamp stale, potentially blocking or contaminating the next run.  
Fix: Update the requeue RPC and tests to delete internals and clear all current-run outcome and lease fields atomically while preserving audit history.

3. **The new FX reasons are not included in the stated schema migration.** Section 9 lists `fx_stale`, while section 15 introduces `fx_invalid` and `fx_missing_rate`; the current DB constraint accepts none of them ([current constraint](/Users/alwynvanvuuren/Desktop/Main%20project%20folder/quoting-agent/supabase/migrations/0018_llm_failure_reasons_and_default_grants.sql:13)).  
Fix: Enumerate the complete final reason taxonomy once and update Zod, database constraints, dashboard labels, outcome schemas, and evals from that list.

4. **Failure after excluding every offer is undefined.** `inconsistent_offer` is only a trace exclusion, so the engine has no specified unpriceable reason when every otherwise matching offer is inconsistent.  
Fix: Define a distinct configuration-error result and gate mapping for “rates matched but every offer was invalid.”

5. **Candidate overflow is misclassified as an out-of-scope lane.** A valid lane with more than 200 options is configuration or capacity failure, not absence of a lane.  
Fix: Return a named `pricing_capacity_exceeded` configuration error instead of `out_of_scope_lane`.

6. **Margin formulas remain implicit.** The ranges do not state the actual calculations, particularly whether gross margin is `buy / (1-value)` and how line rounding affects the realized percentage.  
Fix: Specify exact MARKUP and GROSS_MARGIN equations, rounding points, and worked boundary vectors.

7. **Minimum margin is undefined for mixed BUY/SELL offers.** SELL lines have no known buy amount, so “option buy and sell totals” cannot produce a meaningful margin if one offer contains both price kinds.  
Fix: Require one `price_kind` per offer or calculate minimum margin exclusively over the explicitly identified BUY-derived subset.

8. **FX still has an intermediate approximation.** DP 20 division is finite rounding, so “full precision” and “rounded once” are not literally true and can change a half-minor-unit decision near the allowed amount bound.  
Fix: Use integer/rational conversion with quotient-and-remainder final rounding, or prove and enforce a precision bound that cannot affect any permitted monetary result.

9. **FX receipts do not distinguish buy and sell conversions.** Minimum-margin evaluation converts both totals, but the output still describes one conversion per source-currency subtotal without identifying which amount was converted.  
Fix: Record separate typed `BUY` and `SELL` conversion receipts, or a single receipt containing both input/output pairs.

10. **Offer identity is not scoped to a tariff.** Matching on only `carrier + offer_id` can combine lines from unrelated tariffs that reuse an offer identifier.  
Fix: Compose on `(tariff_id, carrier, offer_id)` unless `offer_id` is explicitly validated as globally unique within the tenant snapshot.

11. **Shipment-charge equality is incomplete.** Comparing only ID, rate, currency, and min/max can accept conflicting codes, descriptions, categories, percentage dependencies, or other basis metadata.  
Fix: Require canonical equality of the entire shipment-level `ChargeDef`, excluding only fields explicitly proven non-semantic.

12. **`min` and `max` still lack a concrete monetary type.** They appear beside decimal rates but are applied as currency amounts after rounding, leaving major/minor-unit interpretation ambiguous.  
Fix: Model clamps as bounded `Money` in charge currency, or explicitly define canonical major-unit decimal parsing and conversion to minor units.

13. **The extraction regex accepts negative measurements.** Negative dimensions, weights, totals, and quantities satisfy the authoritative section-15 transport rule unless every consumer adds separate validation.  
Fix: Define field-level constraints centrally: dimensions/weights/volumes strictly positive, counts positive integers, and percentages/rates within their declared ranges.

14. **Hash determinism depends on unstated identifier invariants.** Sorting only by ID is nondeterministic when IDs collide, while tariff and rate-line ID uniqueness is not part of load validation.  
Fix: Require unique tariff, rate-line, and charge identifiers within the snapshot and hash canonical header metadata plus fully sorted canonical rows.

15. **Persistence cleanup after a losing or failed attempt is incomplete.** Attempt-token checks prevent stale writes, but the plan does not state that quote, draft, internals, outcome detail, and audit insertion occur only after the token-guarded status transition succeeds.  
Fix: Make the token-checked transition the first statement inside one transaction and return before every artifact write when it does not match.

VERDICT: REVISE

### Claude's response
All 15 accepted, consolidated as spec §16 (highest precedence). Design change from #8: all arithmetic exact (bigint decimals; single rational division with one half-up rounding); big.js demoted to a test oracle.

## Resolution
MAX_ROUNDS (3) reached with VERDICT: REVISE. Not converged by Codex sign-off — but every finding across all rounds (75) was accepted and incorporated; there is **no open disagreement** between Claude and Codex. Codex reviews the implementation (code review) after the build, which is the next check on these rules.

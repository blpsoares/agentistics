# Can the Vercel AI SDK be the provider layer of a metrics-grade agent harness?

Research date: 2026-09-20. Sources: `github.com/vercel/ai` cloned shallow at HEAD (commit current as
of today; `packages/provider@4.0.17` matches the published `@ai-sdk/provider@4.0.17` that the
published `ai@7.0.107` depends on, so the checkout reflects the live release, not an ahead-of-trunk
preview) into `/tmp/ai-sdk-research/ai-repo`; `npm view`/`npm registry` metadata; a real `bun add` +
`bun build --compile` under `/tmp/ai-sdk-research/bun-test` (not installed into the product repo);
one Anthropic docs page via WebFetch. Every claim below is either a file:line citation into the
cloned source or a command I ran and pasted the output of. Anything I could not verify is marked
**UNVERIFIED**.

---

## 0. Which spec version is actually live

The `ai` npm package has gone through six major versions (2→7). The **provider contract**
(`LanguageModelVN`) has its own, slower version counter, currently at **v4** — `@ai-sdk/provider`
ships `v2`, `v3` and `v4` copies of the language-model types side by side
(`packages/provider/src/language-model/{v2,v3,v4}/`) for backward compatibility, and every
first-party provider I inspected (Anthropic, OpenAI, Google) implements `v4`
(`specificationVersion: 'v4'`). Everything below describes **v4**, the shape you'd actually be
coding against today.

The move from v2→v3 usage shape is itself informative: **v2's `LanguageModelV2Usage` was a flat
`{inputTokens, outputTokens, totalTokens, reasoningTokens?, cachedInputTokens?}`** — no cache-write
split, no raw passthrough. v3/v4 replaced it with the structured, cache-write-aware, raw-carrying
shape described below. This is a real quality improvement, but it also means **the SDK's own
answer to "what does usage fidelity mean" changed underneath users at least once already**
(`packages/provider/src/language-model/v2/language-model-v2-usage.ts` vs `.../v4/language-model-v4-usage.ts`).

---

## 1. Usage fidelity

**Common shape (`LanguageModelV4Usage`, `packages/provider/src/language-model/v4/language-model-v4-usage.ts`):**
```ts
inputTokens:  { total, noCache, cacheRead, cacheWrite }   // all number | undefined
outputTokens: { total, text, reasoning }                   // all number | undefined
raw?: JSONObject   // "the usage information in the shape the provider returns"
```
The public re-export in the `ai` package (`packages/ai/src/types/usage.ts`, `LanguageModelUsage`) is
the same shape renamed (`inputTokenDetails.{noCacheTokens,cacheReadTokens,cacheWriteTokens}` etc.)
plus a computed `totalTokens`, and it **also carries `raw?: JSONObject`** — `asLanguageModelUsage()`
copies `usage.raw` straight through.

**Per provider, what actually fills that shape** (`convertAnthropicUsage`, `convertOpenAIResponsesUsage`,
`convertGoogleUsage` — all pure functions, all with `raw` set to the provider's own object):

| Field asked about | Modeled as a typed field? | Where |
|---|---|---|
| Anthropic cache-creation vs cache-read | **Yes** — `cache_creation_input_tokens` → `cacheWrite`, `cache_read_input_tokens` → `cacheRead` | `packages/anthropic/src/convert-anthropic-usage.ts` |
| Anthropic per-TTL cache buckets (`cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`) | **No.** The typed `AnthropicUsage`/zod schema only declares the two flat counters; there is no field in `LanguageModelV4Usage` for a TTL breakdown | see below |
| OpenAI `reasoning_tokens` | **Yes** — `output_tokens_details.reasoning_tokens` → `outputTokens.reasoning` | `packages/openai/src/responses/convert-openai-responses-usage.ts:34` |
| OpenAI `cached_tokens` | **Yes** — `input_tokens_details.cached_tokens` → `inputTokens.cacheRead` | same file, line 33 |
| Google `thoughtsTokenCount` | **Yes** → `outputTokens.reasoning` | `packages/google/src/convert-google-usage.ts:35` |
| Google `cachedContentTokenCount` | **Yes** → `inputTokens.cacheRead` | same file, line 34 |

**The per-TTL Anthropic bucket is a real, confirmed loss in the typed shape**, and it is real data:
per Anthropic's own docs (fetched today, `platform.claude.com/docs/en/build-with-claude/prompt-caching`),
a response using mixed 5m/1h caching returns
```json
{"input_tokens":2048,"cache_read_input_tokens":1800,"cache_creation_input_tokens":248,
 "output_tokens":503,"cache_creation":{"ephemeral_5m_input_tokens":148,"ephemeral_1h_input_tokens":100}}
```
The SDK's zod schema for this response (`packages/anthropic/src/anthropic-language-model.ts:1534`) is:
```ts
usage: z.looseObject({
  input_tokens: z.number().nullish(),
  output_tokens: z.number(),
  output_tokens_details: z.object({ thinking_tokens: z.number().nullish() }).nullish(),
  cache_creation_input_tokens: z.number().nullish(),
  cache_read_input_tokens: z.number().nullish(),
  iterations: z.array(...).nullish(),
}),
```
No `cache_creation` sub-object is declared. Because it's `z.looseObject` (Zod v4's passthrough
mode), an actual `cache_creation.{ephemeral_5m_input_tokens,ephemeral_1h_input_tokens}` key **would
survive parsing as an untyped extra key** on `response.usage`, and that whole object is stuffed,
byte-for-byte, into `providerMetadata.anthropic.usage` (`anthropic-language-model.ts:1553-1557`,
`usage: response.usage as JSONObject`) and into `LanguageModelV4Usage.raw` (`convert-anthropic-usage.ts:97`,
`raw: rawUsage ?? usage`, and the call site never passes `rawUsage`, so it defaults to the full
parsed `usage` object). **So the per-TTL split is not lost from the wire, but it is lost from the
typed model**: `cacheWrite` is the flat sum of both buckets, and getting the 5m/1h split back
requires reaching into `providerMetadata.anthropic.usage.cache_creation` as `unknown`/`JSONObject`
with no compiler help and no guarantee the key name doesn't change.

**Anthropic's `iterations` array is a second, separate loss vector worth flagging.** When a
turn triggers server-side compaction or an advisor sub-call, Anthropic returns per-iteration usage
(`compaction`/`message`/`advisor_message`/`fallback_message`, each with its own token counts and
optionally its own `model`). `convertAnthropicUsage` **deliberately excludes advisor-billed tokens
from the top-level totals** ("Advisor tokens are NOT rolled into the top-level totals because they
bill at a different rate" — comment in `anthropic-message-metadata.ts`). This is the *correct* call
for a metrics product (mirrors this repo's own "price each model at its own rate" rule for
subagents) but it means **`usage.inputTokens`/`outputTokens` from the common shape silently exclude
real billed tokens**, recoverable only from `providerMetadata.anthropic.iterations` (typed, at
least — this one *is* modeled: `AnthropicUsageIteration[]`).

**Provider-metadata passthrough is typed as `SharedV4ProviderMetadata`, which is `Record<string,
Record<string, JSONValue>>`** (i.e. `Record<providerId, Record<key, JSONValue>>`) — a typed
*container*, but the payload inside is `JSONValue`/`unknown`, not typed per field. So: yes, there is
a passthrough for fields the common shape doesn't model, and yes, it degrades to `any`-shaped JSON
the moment you read a specific key out of it.

**Verdict for Q1:** the common shape correctly models the three cross-provider dimensions that
matter most (cache read/write, reasoning tokens) and is honest about `undefined` vs `0` (every field
is `number | undefined`, matching this repo's own N/A-vs-confident-0 house rule). It **loses, in the
typed model**: Anthropic's per-TTL cache-write buckets, and (by design, correctly) Anthropic's
advisor/fallback per-iteration attribution. Both are recoverable from `raw`/`providerMetadata`, but
only as untyped JSON the caller must know the shape of ahead of time — which is exactly the kind of
knowledge this repo's own `antigravity-protobuf.ts` incident (CLAUDE.md: reverse-engineered field
mapped wrong, off by 4.8x, caught only by reconciling against the vendor's own console) says you
must verify by hand and pin with a test, not trust from an SDK's best-effort passthrough.

---

## 2. Request identity

**Yes, both are obtainable, and through the same field, not a special API.**

- Provider's own response id: `LanguageModelV4ResponseMetadata.id` (`.../v4/language-model-v4-response-metadata.ts`)
  — Anthropic sets it from `response.id` (`anthropic-language-model.ts:1547`, the `msg_...` id);
  surfaced as `result.response.id` (`generateText`/`streamText`) and per-step as `step.response.id`.
- Raw HTTP response headers (which is where a `request-id`/`x-request-id` header lives): captured by
  `extractResponseHeaders(response: Response) { return Object.fromEntries([...response.headers]) }`
  (`packages/provider-utils/src/extract-response-headers.ts`) — **indiscriminate**, every header the
  fetch `Response` carries, not a curated allowlist — and threaded through as
  `LanguageModelV4GenerateResult.response.headers` (`.../v4/language-model-v4-generate-result.ts`),
  then into the public result: `packages/ai/src/generate-text/generate-text.ts:1061`,
  `headers: result.response?.headers`. So `result.response.headers['request-id']` (Anthropic) /
  `['x-request-id']` (OpenAI) works with no extra plumbing, on every `generateText`/`streamText`
  call and every `step` in a multi-step run — not gated behind `onFinish`, though `onFinish` also
  receives it.
- Raw response body is *also* kept: `response?: { ...; body?: unknown }` on the same type, populated
  from the raw parsed JSON (`rawResponse` in `anthropic-language-model.ts`). This is a strong
  fidelity feature: a caller can always fall back to the untouched provider JSON for reconciliation.

---

## 3. Streaming

**Vocabulary** (`LanguageModelV4StreamPart`, `.../v4/language-model-v4-stream-part.ts`): `text-start`
/ `text-delta` / `text-end`, `reasoning-start` / `reasoning-delta` / `reasoning-end`,
`tool-input-start` / `tool-input-delta` / `tool-input-end` (tool-call **argument** deltas — a
distinct family from text deltas, confirming Q3's specific ask), plus discrete
`tool-call`/`tool-result`/`tool-approval-request` parts, `file`/`source`/reasoning-file parts,
`stream-start` (warnings), `response-metadata`, **`finish` (carries `usage` + `finishReason` +
`providerMetadata`)**, a passthrough `raw` part (`{type:'raw', rawValue: unknown}` — an escape hatch
for anything the common vocabulary doesn't cover), and `error`.

**Usage at stream end:** reported once, in the `finish` part, at the language-model level. At the
`ai`-package level (`stream-text.ts`), the running total is tracked in `recordedTotalUsage` and only
finalized in the transform stream's `flush()` handler (`stream-text.ts:1717-1746`):
```ts
if (recordedSteps.length === 0 || recordedNoOutputError != null) {
  self.rejectResultPromises(error);   // usage promise REJECTS
  return;
}
const totalUsage = recordedTotalUsage ?? createNullLanguageModelUsage();
self._totalUsage.resolve(totalUsage);
```
So: **if at least one step completed, `result.usage`/`result.totalUsage` resolve with real numbers
even if a later step or the stream itself then errors or is aborted; if zero steps ever completed,
the usage promise *rejects*, it does not resolve to a null/zero usage.** A caller who does
`await result.usage` without a try/catch on a call that fails before any step finishes will throw,
not read zeros — this is arguably the *right* failure mode for a metrics product (no silent zero)
but it means the caller must handle both a resolved-null-ish usage and a rejection, not just one.

**Confirmed multi-step aggregation loses `raw`.** `addLanguageModelUsage()`
(`packages/ai/src/types/usage.ts`) — used to fold each step's usage into `totalUsage` — returns an
object with **no `raw` key at all**:
```ts
export function addLanguageModelUsage(usage1, usage2): LanguageModelUsage {
  return { inputTokens: ..., inputTokenDetails: {...}, outputTokens: ..., outputTokenDetails: {...},
            totalTokens: ... };   // <-- no `raw` field
}
```
A single-step call gets `usage.raw` (via `asLanguageModelUsage`); **any multi-step call (which is
the normal shape of a tool-using coding-agent turn) has `result.usage.raw === undefined` on the
summed total** — only `result.steps[i].usage.raw` retains the provider's raw object, per step. For
a harness whose own accounting principle is "one billed response = one event" (this repo's own
`usage-dedupe.ts` rule), this is not fatal — the natural unit to record is the step/response anyway,
not the pre-summed total — but it means **you must never rely on `result.usage.raw`**; always
iterate `result.steps[]`.

---

## 4. Tool calling

- **Declaration:** `tool({ description, inputSchema, execute })` with a Standard Schema
  (zod v3/v4, valibot, or hand-rolled JSON Schema) for `inputSchema`; multiple tools passed as a
  `ToolSet` record. Confirmed via `packages/ai/src/generate-text/tool-*.ts` and the `zod`
  peerDependency range `^3.25.76 || ^4.1.8` (`npm view ai@7.0.107 peerDependencies`).
- **Results:** returned as discrete `tool-result` content parts (typed vs `DynamicToolResult` for
  tools not statically known), matched to their call by `toolCallId`.
- **Parallel tool calls:** representable natively — a single step's `content: Array<LanguageModelV4Content>`
  can hold multiple `tool-call` entries (one assistant turn, several tool uses), each with its own
  id; there is no artificial one-tool-per-step constraint in the type.
- **Malformed tool call:** two typed errors — `NoSuchToolError` (model invoked a tool name absent
  from the tool set) and `InvalidToolInputError` (arguments fail schema validation) —
  `packages/ai/src/generate-text/parse-tool-call.ts`, `packages/ai/src/error/{no-such-tool-error,invalid-tool-input-error}.ts`.
  An optional user-supplied `repairToolCall` callback gets a chance to fix it before the error
  surfaces; if the repair itself throws, it's wrapped as `ToolCallRepairError`
  (`packages/ai/src/error/tool-call-repair-error.ts`). Without a repair function the error is a typed,
  catchable object rather than an opaque failure — good for a metrics harness that wants to record
  "malformed tool call" as its own event category rather than a generic exception.

---

## 5. Errors and retries — **the SDK retries silently, by default, and this is exactly the kind of
thing that breaks "one billed response = one event" accounting**

`retryWithExponentialBackoff` (`packages/provider-utils/src/retry-with-exponential-backoff.ts`):
- **Default `maxRetries = 2`**, exponential backoff (`initialDelayInMs = 2000`, `backoffFactor = 2`),
  configurable per call via `generateText({ maxRetries })`/`streamText({ maxRetries })`, and
  **disable-able with `maxRetries: 0`** (confirmed: `if (maxRetries === 0) { throw error; }`, no
  retry attempted at all).
- **A retry that eventually succeeds is invisible to the caller.** There is no `onRetry` callback in
  this file, and I found none wired at the `generateText`/`streamText` option level. The only trace
  of a retry sequence is inside a *thrown* `RetryError`'s `.errors` array — and that only exists when
  **all** attempts failed (`AI_RetryError`, `reason: 'maxRetriesExceeded' | 'errorNotRetryable'`). A
  request that failed once (say, a `529 overloaded`) and succeeded on attempt 2 produces exactly one
  successful `LanguageModelV4GenerateResult`, indistinguishable from a first-try success, unless you
  separately instrument the fetch layer (e.g. via `fetch` override or OTel spans in `@ai-sdk/otel`)
  to see the failed attempt.
- **Retries only fire on network/transport-shaped errors that survive to the JS layer as "not
  aborted"** — `if (isAbortError(error)) throw error; // don't retry when the request was aborted`.
  Non-retryable errors (4xx other than 429, malformed JSON, etc.) are not retried at all
  (`shouldRetry`, driven by `APICallError.isRetryable`, set per status code by each provider's
  error-mapping code, e.g. Anthropic maps its `529 overloaded_error` to `isRetryable: true` —
  `packages/anthropic/src/anthropic-error.ts`).
- **No idempotency-key mechanism.** I grepped the whole monorepo (`grep -rl idempotency
  packages/*/src`) and found **zero** hits in any language-model provider — the only "idempotency"
  hits are unrelated (`generate-video`, the `gateway` batch API). Anthropic's own Messages API
  supports an `Idempotency-Key` header for exactly this problem (retried timeout that actually
  succeeded server-side would double-bill); the AI SDK does not send one. **This is a real,
  unmitigated risk for a metrics-grade harness**: a client-side timeout retry, if it ever races a
  request that the provider actually completed and billed, would be silently invisible as a
  duplicate billed response, and there is no SDK-level signal to catch it. (Whether this actually
  happens in practice depends on your own timeout configuration relative to typical latencies —
  **UNVERIFIED** whether it has been observed in the wild; flagging it as an architectural gap, not
  a confirmed incident.)

**Consequence for the spec:** if this SDK is adopted, the harness must either (a) set
`maxRetries: 0` and own retries itself with an idempotency key of its own devising, keeping every
attempt visible to the accounting layer, or (b) accept that "one billed response = one event" is
only true modulo an invisible, un-auditable SDK-level retry layer.

---

## 6. Abort/cancel semantics

- `abortSignal` is a first-class option on `generateText`/`streamText`, threaded through to the
  underlying `fetch`.
- **The retry layer itself refuses to retry an aborted call** — `isAbortError(error)` short-circuits
  straight to `throw error`, so an abort never gets "helpfully" retried into a real second billed
  request.
- **On `streamText`, aborting mid-run emits an explicit `onAbort` callback**
  (`stream-text.ts:1868-1873`) with `{ callId, steps: recordedSteps, reason? }` — `recordedSteps` is
  every **fully completed** step up to that point, each carrying its own real `usage` (with `raw`).
  So: **usage for prior completed steps in a multi-step run survives an abort intact**; the
  in-flight step at the moment of the abort contributes **no** usage (there was no `finish` part for
  it — consistent with the provider itself never having sent one, since Anthropic/OpenAI/Google all
  report usage only in their final SSE frame, not incrementally).
- A dedicated `abort` stream part is enqueued to the consumer-facing stream
  (`controller.enqueue({ type: 'abort', reason? })`), so downstream code sees an explicit signal
  distinct from a clean `finish` or an `error`.
- If **zero** steps completed before the abort, the result promises (`usage`, `text`, etc.) **reject**
  with the abort reason rather than resolving to an empty/zero usage (same `flush()` branch as the
  hard-error case in §3).

---

## 7. Extensibility

- **Middleware:** `LanguageModelV4Middleware` (`packages/provider/src/language-model-middleware/v4/...`)
  — `transformParams`, `wrapGenerate`, `wrapStream`, plus `overrideProvider`/`overrideModelId`/
  `overrideSupportedUrls`. Applied via `wrapLanguageModel({ model, middleware })`. This is exactly the
  seam you'd use to inject your own usage-capture/telemetry logic around every call without touching
  provider code — e.g. `wrapGenerate` gets the fully-resolved `LanguageModelV4GenerateResult`
  (including `.usage.raw` and `.response.headers`) before it's returned upstream.
- **Custom providers:** `LanguageModelV4` is a plain, fully documented interface
  (`packages/provider/src/language-model/v4/language-model-v4.ts` — `specificationVersion`,
  `provider`, `modelId`, `doGenerate`, `doStream`, `supportedUrls`); nothing prevents implementing it
  from scratch and passing an instance directly to `generateText({ model: myModel })`. No
  registration step, no plugin system to fight.
- **Local models / OpenAI-compatible endpoints:** there is a first-party
  `@ai-sdk/openai-compatible` package (`createOpenAICompatible({ name, baseURL, apiKey? })`) that
  implements `LanguageModelV4` against any OpenAI-Chat-Completions-shaped HTTP endpoint. I verified
  it actually instantiates and type-checks against a local Ollama-style base URL
  (`http://localhost:11434/v1`) in the Bun test harness below. **There is no first-party `@ai-sdk/ollama`
  package** — I listed all 82 packages in the monorepo and grepped for `ollama`/`lmstudio`/`local`:
  none. Ollama support is second-class in the sense that you go through the generic
  OpenAI-compatible shim (which, per §1, only ever fills in whatever subset of the v4 usage shape
  the OpenAI-compatible response happens to carry — Ollama's own usage reporting is minimal, so
  expect `cacheRead`/`cacheWrite`/`reasoning` to be `undefined` there in practice — **UNVERIFIED**
  against a live Ollama instance, not tested here). A community package `ollama-ai-provider-v2`
  exists on npm but is not Vercel-maintained and was out of scope to audit.

---

## 8. Weight and runtime fit

Verified with a real install and a real compile, not npm metadata alone (`/tmp/ai-sdk-research/bun-test`,
outside the product repo, nothing installed into `agentistics`):

```
$ bun add ai@7.0.107 @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google @ai-sdk/openai-compatible zod
installed ai@7.0.107, @ai-sdk/anthropic@4.0.58, @ai-sdk/openai@4.0.71, @ai-sdk/google@4.0.76,
@ai-sdk/openai-compatible@3.0.53, zod@4.6.5
15 packages installed [1199.00ms]
```
- **Dependency tree is genuinely lean**: 15 packages on disk for four full provider integrations
  plus zod (`du -sh node_modules` = 33M unpacked, dominated by `.d.ts`/source maps and zod's own
  8.2M of locale/type data — not runtime JS weight).
- `bun build ./index.ts` (importing `streamText`, `generateText`, `wrapLanguageModel`, `anthropic`,
  `openai`, `google`, `createOpenAICompatible`) → **112 modules bundled into a 2.38 MB single JS
  file**, zero warnings.
- **Zero `require(` calls anywhere in the bundled output** (`grep -c "require(" index.js` → `0`) —
  fully ESM, statically resolvable. This directly answers the repo's own scar tissue
  (CLAUDE.md's `react-devtools-core` stub story, where a *different* library's dynamic
  `await import()` got resolved statically by Bun's bundler and broke the binary build): the AI SDK
  as of v7 removed CommonJS entirely (`ai@7.0.0` changelog: "Remove CommonJS exports from all
  packages. All packages are now ESM-only") and I found no dynamic-import/dynamic-require pattern in
  the bundle to trip a bundler the way that stub had to work around.
- **`bun build --compile` succeeds** and the resulting single-file binary runs cleanly
  (`./aitest` → exit 0, all imports resolve as functions). Binary size 92.6 MB, but that figure is
  dominated by the ~90 MB Bun runtime baked into every `--compile` output regardless of payload —
  the SDK's own marginal contribution is the 2.38 MB bundle above.
- **One dependency worth flagging**: `@ai-sdk/provider-utils` depends on `undici` (`^7.29.0`) as a
  real (non-optional) dependency (`node_modules/@ai-sdk/provider-utils/package.json`). Under Bun this
  bundled fine and added no runtime error, but it is dead weight in a Bun-first runtime (Bun ships
  its own `fetch`); **UNVERIFIED** what exactly undici is used for at runtime (likely Node-only proxy
  agent support) — worth a follow-up if binary size becomes a concern, but it did not break anything
  here.

---

## 9. Licence, release cadence, stability

- **Licence: Apache-2.0**, confirmed identical across `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`
  (`npm view <pkg> license`) — permissive, no copyleft concern for a closed-source/compiled-binary product.
- **Major-version cadence** (`npm view ai time --json`, exact publish timestamps):

  | Version | Published | Gap from previous |
  |---|---|---|
  | 2.0.0 | 2023-06-14 | — |
  | 3.0.0 | 2024-02-29 | ~8.5 months |
  | 4.0.0 | 2024-11-18 | ~8.7 months |
  | 5.0.0 | 2025-07-31 | ~8.5 months |
  | 6.0.0 | 2025-12-22 | ~4.7 months |
  | 7.0.0 | 2026-06-25 | ~6.0 months |

  Six majors in a bit over three years, roughly every 5-9 months and **trending faster, not
  slower**. Each one carries real breaking changes, not just version-number churn — the 7.0.0
  changelog alone lists ~15 "Major Changes" entries including renamed exports
  (`stepCountIs`→`isStepCount`), removed exports (`experimental_customProvider`,
  `ToolCallOptions`), a full CJS removal, and a reshaped `ToolResultOutput` type.
- **Mitigating factors**: (a) the provider *specification* (`LanguageModelVN`) versions much more
  slowly than the `ai` package itself — it's at v4 while `ai` is at v7, and old spec versions
  (v2, v3) are kept side-by-side in `@ai-sdk/provider` rather than deleted, so a provider package
  pinned to an older spec keeps working; (b) Vercel maintains parallel dist-tags for prior majors
  (`npm view ai` → `dist-tags` includes `ai-v6: 6.0.286`, `ai-v5: 5.0.261` alongside `latest:
  7.0.107`), i.e. old majors still receive patches, not abandoned outright; (c) the `zod`
  peerDependency range (`^3.25.76 || ^4.1.8`) is deliberately wide, suggesting some care about not
  forcing a peer-dep major on every consumer.
- **Given the trend (cadence shortening, not lengthening) and that the provider spec has bumped
  every major so far, a v5 language-model spec landing within this project's lifetime is a
  reasonable expectation, not a remote one.** (Forward-looking, not a confirmed roadmap item —
  flagging as informed inference, not fact.)

---

## Verdict

**(a) What we can depend on it for.** The HTTP mechanics, request/response shape normalization,
streaming state machine, tool-call orchestration (including multi-step agentic loops, parallel tool
calls, and typed malformed-tool-call errors), middleware seam, and the "download every header /
keep the raw body" habit are all solid and match what a metrics product needs at the plumbing layer.
Anthropic cache-read/cache-write, OpenAI `reasoning_tokens`/`cached_tokens`, and Google
`thoughtsTokenCount`/`cachedContentTokenCount` are all genuinely modeled as typed fields, not
approximated — that's the majority of the fidelity surface this project's own house rules (the
`tokens.ts` "all four counters" rule, the N/A-vs-0 rule) actually require, and the SDK gets it right
by default rather than by accident.

**(b) What we must capture around it, unconditionally.**
1. **Always read `steps[i].usage.raw` (and `steps[i].response.headers`, `.response.id`), never
   `result.usage.raw`** — the multi-step total drops `raw` entirely (`addLanguageModelUsage` has no
   `raw` field). This is a one-line rule to enforce with a lint, exactly like this repo already lints
   for two-term token sums.
2. **Persist `providerMetadata.anthropic.usage` (or the equivalent per-provider metadata blob)
   verbatim alongside the typed usage**, specifically to keep Anthropic's per-TTL `cache_creation`
   breakdown and `iterations` array, neither of which survives into the typed `LanguageModelV4Usage`.
   This is the exact shape of problem this repo already had with `antigravity-protobuf.ts` — an
   undocumented/loosely-typed nested field must be pinned by a test against real API traffic, not
   trusted from an SDK's best-effort JSON passthrough.
3. **Either set `maxRetries: 0` and implement our own retry+idempotency, or accept an unauditable
   retry layer.** As shipped, a successful-after-retry call is indistinguishable from a first-try
   success, and there is no idempotency key sent to the provider — the two together are a real gap
   against "one billed response = one event."
4. **Treat the usage/result promises' reject-vs-resolve split as a first-class case**: zero
   completed steps → promises reject (no usage at all, not zero-usage); one or more completed steps
   → resolve with real numbers for everything that finished, even under a later abort or error. Both
   need distinct handling, not a single catch-all.

**(c) Would thin provider clients we write ourselves be materially better?** For the *specific*
gaps above — Anthropic's TTL cache buckets, the iteration/advisor breakdown, retry visibility,
idempotency — yes, a hand-rolled client neither introduces the same losses nor invisibly changes
shape on someone else's 5-9-month release clock. But the honest cost is real and specific, not
hand-wavy: you would be re-implementing, per provider, the SSE parsing state machine, tool-call
argument-delta accumulation, multi-step/multi-turn tool-loop orchestration, retry/backoff, and abort
propagation that this SDK already has tested and battle-hardened across four+ major providers and
three internal spec revisions — and you would have to re-verify every one of those provider quirks
by hand (which this project's own CLAUDE.md already documents doing, expensively, for five
non-Claude harnesses' *file formats*; doing it again for live HTTP/SSE wire protocols is a
materially bigger and more failure-prone undertaking than parsing a JSONL file after the fact).
**The pragmatic answer is not "SDK vs. hand-rolled" but "SDK, with a mandatory raw/provider-metadata
capture layer bolted on at every call site, plus our own retry/idempotency policy"** — which is
materially less work than a full hand-rolled client and closes every gap identified above except
#3, which needs bespoke idempotency-key handling regardless of which client makes the HTTP call.

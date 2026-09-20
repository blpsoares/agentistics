# Provider APIs — usage accounting, request identity, streaming, tools, caching, rate limits, errors, stop reasons

Research for B1 of the native agent harness (Bun/TypeScript): calling model providers directly and
recording exact usage. All facts below are from the vendors' own primary docs, fetched directly
(not from search-result summaries) on **2026-09-20**, except where marked UNVERIFIED. Anthropic is
covered in the most depth per the brief; OpenAI, Gemini, OpenRouter and Ollama follow.

---

## 1. Anthropic — Messages API

Primary sources (all accessed 2026-09-20):
- Messages reference: https://platform.claude.com/docs/en/api/messages.md
- Errors: https://platform.claude.com/docs/en/api/errors.md
- Rate limits: https://platform.claude.com/docs/en/api/rate-limits.md
- Streaming: https://platform.claude.com/docs/en/build-with-claude/streaming.md
- Tool use overview: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview.md
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md
- Stop reasons: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons.md

### 1.1 Usage accounting — exact fields and nesting

```json
"usage": {
  "input_tokens": 100,
  "output_tokens": 50,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 0,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 0
  },
  "server_tool_use": { "web_search_requests": 1 }
}
```

- **`input_tokens`** — tokens **after the last cache breakpoint only**. It does NOT include
  `cache_creation_input_tokens` or `cache_read_input_tokens`. Documented formula (from the
  rate-limits page, which exists precisely because people get this wrong):
  `total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`.
- **`cache_creation_input_tokens`** — the SUM of `cache_creation.ephemeral_5m_input_tokens` +
  `cache_creation.ephemeral_1h_input_tokens`. The `cache_creation` breakdown is the per-TTL detail
  the brief asked about; it only appears when a request actually writes to both TTL buckets or a
  1h-TTL write occurs (the flat `cache_creation_input_tokens` is always present once any cache
  write occurs; the nested `cache_creation` object is the finer breakdown).
- **`cache_read_input_tokens`** — tokens served from cache, billed at a fraction of input price
  (see §1.5). NOT counted toward ITPM rate limits for most models (Haiku 3.5 is the one documented
  exception — it DOES count cache reads toward ITPM).
- **`output_tokens`** — output tokens. Thinking-block tokens are NOT broken out as a separate usage
  field in the Messages API — they are billed as part of `output_tokens` (unlike OpenAI's Responses
  API, which reports `output_tokens_details.reasoning_tokens` as a named sub-count). This is worth
  flagging: Anthropic's public usage object has **no `thinking_tokens` field**; a thinking-heavy
  turn simply shows a larger `output_tokens`.
- **`server_tool_use.web_search_requests`** — a count, not a token figure; appended when server
  tools (web search) ran. Confirmed live in a streamed `message_delta.usage` in the docs' own SSE
  example.
- **No `total_tokens` field exists in the Anthropic usage object** — callers must sum the four
  counters themselves (this is exactly the trap `packages/core/src/tokens.ts` in this repo's
  CLAUDE.md was built to prevent).

**TRAP, confirmed against a live SSE example in the docs**: in a streaming response, `message_start`
carries an *initial* usage object (`input_tokens` + a placeholder `output_tokens` — the doc's own
example shows `output_tokens: 1` or `2` at `message_start`, i.e. not the final count), and the
**`message_delta` event's `usage` is explicitly documented as CUMULATIVE** ("The token counts shown
in the `usage` field of the `message_delta` event are *cumulative*"). In a non-tool, single-block
example the final `message_delta.usage` was `{"output_tokens": 15}` only (no input side repeated);
in a longer example with server tools, the final `message_delta.usage` repeated the input side too:
`{"input_tokens":10682,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":510,"server_tool_use":{...}}`.
**Do not sum `message_start.usage.output_tokens` + all later deltas** — the correct output count is
whatever the LAST `message_delta.usage` says, full stop; earlier partials are not additive.

### 1.2 Request identity

- **Response body**: top-level `id` field on the `Message` object (`msg_...`), and on error bodies
  a `request_id` field.
- **HTTP header**: the header is **`request-id`** (lowercase, no `anthropic-` or `x-` prefix) —
  confirmed verbatim from the errors page: *"Every API response includes a unique `request-id`
  header... a value such as `req_018EeWyXxfu5pfWkrYcMdjWG`."* This directly resolves the
  UNVERIFIED item in the existing spec: **it is `request-id`, not `x-request-id` and not
  `anthropic-request-id`.**
- Error bodies also carry `request_id` (snake_case, in the JSON, distinct from the header's
  hyphenated name) — same value, two representations.
- On **Claude Platform on AWS** specifically, responses carry TWO ids: `x-amzn-requestid` (primary,
  for CloudTrail) and `request-id` (secondary, for Anthropic support) — don't conflate the two if
  B1 ever adds a Bedrock/AWS-native backend.
- SDK access: Python/TypeScript expose `_request_id` on the parsed response object; other SDKs read
  it off the raw-response accessor; Ruby via middleware. For a hand-rolled TS client, just read the
  `request-id` response header directly — no SDK needed.
- Other useful response headers: `anthropic-organization-id`, `anthropic-workspace-id` (tells you
  which workspace a key resolved to).

### 1.3 Streaming — verified event sequence (not summarized — pulled the literal SSE examples)

Canonical order, confirmed against three real SSE transcripts in the docs (plain text, tool-use,
and server-tool/web-search):

```
event: message_start        data: {message: {..., content: [], usage: {input_tokens, output_tokens: <initial-estimate>}}}
  [per content block, index 0..n:]
event: content_block_start  data: {index, content_block: {type, ...}}
  [zero or more:]
event: ping                 data: {}
event: content_block_delta  data: {index, delta: {...}}   (repeats)
event: content_block_stop   data: {index}
  [one or more, across the whole turn:]
event: message_delta        data: {delta: {stop_reason, stop_sequence}, usage: {...cumulative...}}
event: message_stop         data: {}
```

- `ping` events can appear anywhere and must be ignored, not just once — the docs' own text example
  has a `ping` in the middle of `content_block_delta`s.
- **Text**: `content_block_start` with `content_block: {type:"text", text:""}`, then
  `content_block_delta` with `delta.type: "text_delta"`, `delta.text` (the actual chunk).
- **Tool use (client tool)**: `content_block_start` with `content_block: {type:"tool_use", id,
  name, input: {}}` (input starts EMPTY), then one or more `content_block_delta` with
  `delta.type: "input_json_delta"`, `delta.partial_json` — these are **partial JSON string
  fragments, not necessarily valid JSON prefixes**; accumulate the strings and `JSON.parse` only
  after `content_block_stop`. The docs explicitly warn: current models emit one complete
  key/value property from `input` at a time, chunked as multiple deltas, so there can be
  multi-second gaps between deltas while a tool call streams.
- **Server tool use**: identical shape but `content_block.type: "server_tool_use"`, and the tool's
  *result* arrives as its own content block (e.g. `type: "web_search_tool_result"`) with a
  `content_block_start`/`content_block_stop` pair and NO deltas in between (result already
  materialized server-side).
- **Thinking**: `content_block_start` type `"thinking"`, then `thinking_delta` events carrying
  `delta.thinking` text, then — **immediately before `content_block_stop`** — a single
  `signature_delta` event carrying `delta.signature` (opaque, used to verify/replay the block).
  With `display: "omitted"`, you still get the full lifecycle (`thinking_delta` with an EMPTY
  string, then the `signature_delta`) — the block is never skipped, only its text is blank.
- **Fallback (Claude Fable 5.1 / 5)**: a `fallback` content block appears as a
  `content_block_start`/`content_block_stop` pair with NO deltas at each model-boundary switch; the
  final `message_delta` re-carries `input_transformations` under the relevant beta header.
- **Mid-stream error**: `event: error`, `data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`
  — this is an SSE-level error that arrives AFTER a 200 has already been returned, so ordinary HTTP
  status-code error handling does not apply; you must watch for `event: error` on the wire itself.
- Unknown/new event types must be handled gracefully (forward-compat rule stated in the docs).

### 1.4 Tool use / function calling

- Tool declaration: `{"name", "description", "input_schema": <JSON Schema>, "strict": true|false}`.
  `strict: true` (no beta header) enforces `additionalProperties: false` + `required` and
  guarantees `tool_use.input` validates exactly against the schema.
- `tool_choice`: `{"type": "auto"}` (default), `{"type": "any"}` (call some tool), `{"type": "tool",
  "name": "..."}` (call this one), `{"type": "none"}`. All four accept `disable_parallel_tool_use:
  true/false` except `none`. **Claude Fable 5.1 / Mythos 5.1 reject `any` and `tool` outright with a
  400** — only `auto`/`none` work there; use `strict: true` + a system-prompt nudge, or structured
  outputs, instead.
- Response: `stop_reason: "tool_use"` plus one or more `{"type": "tool_use", "id", "name", "input"}`
  content blocks (input is the FINAL parsed object here, not the streaming partial JSON).
- Sending results back: a `user` message containing one or more
  `{"type": "tool_result", "tool_use_id": "<id>", "content": "...", "is_error": true|false}` blocks.
  For a FAILED tool call, still return a `tool_result` with `is_error: true` — never drop it, or
  the model has no idea what happened to its call.
- **Parallel tool calls are default-on**: one assistant turn can carry several `tool_use` blocks;
  ALL of the corresponding `tool_result` blocks must go back in a SINGLE user message — splitting
  them across multiple messages silently trains the model to stop parallelizing (explicit
  documented warning).
- Pricing overhead: using `tools` adds a hidden system-prompt token cost that varies by model and by
  `tool_choice` (e.g. Claude Opus 5: 286 tokens for `auto`/`none`, 406 for `any`/`tool`) — this shows
  up inside ordinary `input_tokens`, not as a separate usage field.
- Structured/strict output as an alternative to forced tool use: `output_config.format` (JSON
  Schema) on the request; the deprecated `output_format` parameter should not be used in new code.

### 1.5 Prompt caching — mechanics

- **Explicit only** — there is no automatic cross-request prefix caching by default; you must mark
  a `cache_control: {"type": "ephemeral"[, "ttl": "1h"]}` on a content block (or once at the request
  root, which auto-places the breakpoint on the last cacheable block and slides it forward as the
  conversation grows).
- Hash-and-lookback: the system hashes the prefix up to and including the marked block; on a miss it
  walks BACKWARD up to 20 blocks looking for an earlier cache write at a shorter prefix.
- **Minimum cacheable prefix is model-dependent**: 512 tokens (Fable 5/5.1, Mythos 5/5.1, Opus 5),
  1,024 (Opus 4.8, Sonnet 5, Sonnet 4.6/4.5, Opus 4.1/4, Sonnet 4), 2,048 (Mythos Preview, Opus 4.7,
  Haiku 3.5), 4,096 (Opus 4.6/4.5, Haiku 4.5). A shorter prefix silently fails to cache — no error,
  you have to check the usage fields.
- **Max 4 explicit breakpoints per request.** Combining with request-root auto-caching: auto-caching
  consumes one of the 4 slots and 400s if all 4 are already explicitly used (except a no-op case
  where the last block already carries the same TTL).
- **TTL**: default 5 minutes; opt into `"ttl": "1h"`. TTL starts at request time (writing OR
  reading), not at response-generation end — a long streamed response burns into its own cache TTL.
- **Reporting**: `cache_creation_input_tokens` / `cache_read_input_tokens` (flat) plus the nested
  `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` breakdown.
- **Pricing multipliers** (Opus 5 numbers, but the multiplier structure is universal): 5m write =
  1.25× base input; 1h write = 2.0× base input; cache read = 0.1× base input — **except Claude Fable
  5.1 / Mythos 5.1, whose cache-read rate is 0.025× base input**, a materially different discount
  worth hardcoding per-model rather than as one constant.

### 1.6 Rate limits — response headers (exact names)

Token-bucket algorithm, per-organization, per-model-class. Every response carries:

`retry-after` (seconds; ABSENT on the spend-cap 429 — see below), `anthropic-ratelimit-requests-limit`,
`-requests-remaining`, `-requests-reset` (RFC 3339), `-tokens-limit`, `-tokens-remaining`
(rounded to nearest thousand), `-tokens-reset`, `-input-tokens-limit/-remaining/-reset`,
`-output-tokens-limit/-remaining/-reset`, and (Priority Tier only) the `anthropic-priority-*`
mirror set. `anthropic-ratelimit-tokens-*` reflects whichever limit (org or workspace) is currently
most restrictive.

**Cache-aware ITPM (a real trap)**: for most models, `cache_read_input_tokens` does NOT count
toward the ITPM limit — only `input_tokens` + `cache_creation_input_tokens` do. So a client that
naively sums all four usage counters to estimate "tokens consumed against my rate limit" will
overcount; the correct ITPM-consumption estimate is `input_tokens + cache_creation_input_tokens`
(Haiku 3.5 is the one model where cache reads DO count).

**429 body** for an ordinary rate limit: standard error shape, `error.type: "rate_limit_error"`,
`retry-after` header present. **429/400 spend-cap body is different**: `error.details.error_code:
"enforced_spend_limit_reached"`, **no `retry-after` header at all** — retries (including SDK
auto-retry) will keep failing until the next billing period; a client must special-case this via
`error.details.error_code`, not just the HTTP status.

### 1.7 Errors — taxonomy and retry guidance

| HTTP | `error.type` | Retryable | Notes |
|---|---|---|---|
| 400 | `invalid_request_error` | No | also used for spend-limit-exceeded (non-Claude-Code workspace) |
| 401 | `authentication_error` | No | bad/expired/revoked key |
| 402 | `billing_error` | No | |
| 403 | `permission_error` | No | |
| 404 | `not_found_error` | No | |
| 409 | `conflict_error` | Yes (after resolving) | concurrent modification / uniqueness conflict |
| 413 | `request_too_large` | No | 32 MB Messages/count_tokens, 256 MB Batches, 500 MB Files |
| 429 | `rate_limit_error` | Yes, honor `retry-after` | see spend-cap caveat above |
| 500 | `api_error` | Yes, exponential backoff | include `request_id` when contacting support |
| 504 | `timeout_error` | Yes | prefer streaming for long requests |
| 529 | `overloaded_error` | Yes | can appear mid-STREAM as an `event: error` too |

Error body shape (always): `{"type":"error","error":{"type":"...","message":"..."},"request_id":"req_..."}`.
Official SDKs auto-retry transient failures (connection errors, rate limits, 5xx) **twice by
default** with exponential backoff, honoring `retry-after` when present; max-retries is
configurable per client.

### 1.8 Stop reasons — complete list

`end_turn`, `max_tokens`, `stop_sequence` (check the sibling `stop_sequence` field for which one
fired), `tool_use`, `pause_turn` (server-tool loop hit its default 10-iteration cap — NOT the same
as `tool_use`; resume by re-sending the assistant's content as-is with the same `tools` array and
letting the API finish the deferred server tool), `refusal` (safety decline; check `stop_details.category`
— an open enum incl. `cyber`/`bio`/`reasoning_extraction`/`frontier_llm`/`null`; only populated when
`stop_reason == "refusal"`, `null` otherwise), and `model_context_window_exceeded` (the response
itself filled the context window — treat as truncated, similar remediation to `max_tokens`).

---

## 2. OpenAI — Responses API and Chat Completions

Docs moved from `platform.openai.com/docs/...` to **`developers.openai.com/api/docs/...`**
(301 redirect, confirmed 2026-09-20) — cite the new domain going forward. Primary sources:
- Responses/Chat API reference (JS-rendered SPA — the parts of the schema that rendered are cited
  inline where extracted verbatim; where the schema didn't render at all this is stated as such)
- Prompt caching guide, reasoning guide, function-calling guide, error-codes guide, rate-limits
  guide, streaming-responses guide, API overview page (all under `developers.openai.com/api/docs/`)

### 2.1 Usage accounting

**Chat Completions** `usage` object (confirmed field-by-field from the API reference page):
```json
"usage": {
  "prompt_tokens": 0,
  "completion_tokens": 0,
  "total_tokens": 0,
  "prompt_tokens_details": { "cached_tokens": 0, "audio_tokens": 0 },
  "completion_tokens_details": {
    "reasoning_tokens": 0, "audio_tokens": 0,
    "accepted_prediction_tokens": 0, "rejected_prediction_tokens": 0
  }
}
```

**Responses API** `usage` object (confirmed from the reasoning guide + prompt-caching guide, which
both quote it directly; the full object schema page itself did not render through fetch, so the
top-level shape below is corroborated across two independent guide pages rather than the reference
page proper):
```json
"usage": {
  "input_tokens": 0,
  "input_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 0 },
  "output_tokens": 0,
  "output_tokens_details": { "reasoning_tokens": 0 },
  "total_tokens": 0
}
```
(`cache_write_tokens` under `input_tokens_details` is documented only for GPT-5.6+ prompt-caching;
UNVERIFIED whether it is present for older Responses-API models — the prompt-caching guide's own
text distinguishes "GPT-5.6+" caching behavior from "earlier models" without giving the older
usage shape explicitly.)

**TRAP — reasoning tokens are INSIDE `output_tokens`, not additional to it.** Confirmed verbatim
from the reasoning guide: *"Reasoning tokens are counted as output tokens and included within the
total `output_tokens` count."* So `output_tokens_details.reasoning_tokens` is a sub-count, not a
sibling to sum in — the same shape as Anthropic's cache fields being sub-counts of "total input,"
just on the output side instead. A naive `output_tokens + reasoning_tokens` double-counts.

**TRAP — `total_tokens` is a real field here (unlike Anthropic)**, but it is unclear from the
fetched docs whether it includes cached tokens (it should, since `input_tokens` includes
`cached_tokens` as a sub-count per the caching guide's cache-hit-rate formula: "dividing total
cached tokens by total input tokens" implies `cached_tokens ⊆ input_tokens`). Treat
`input_tokens`/`prompt_tokens` as ALREADY inclusive of the cached sub-count — opposite of
Anthropic, where `input_tokens` explicitly EXCLUDES the cache counters. **This asymmetry between
providers is the single most dangerous naming trap for a canonical usage shape**: the same field
name (`input_tokens`) means "everything including cache" for OpenAI and "only the tokens after the
last cache breakpoint" for Anthropic.

### 2.2 Request identity

- **Header: `x-request-id`** (confirmed verbatim from the API overview page: *"Unique identifier
  for this API request (used in troubleshooting)"*). This is the OpenAI equivalent of Anthropic's
  `request-id` — different name, same purpose.
- SDKs expose it as `_request_id` on top-level response objects (Python/general pattern); for a
  failed request, catch `APIStatusError` and read its `.request_id` property.
- You can also SEND your own idempotency/trace id via the request header **`X-Client-Request-Id`**
  (ASCII, ≤512 chars) — useful for B1's own request correlation before the response even lands.
- Other response meta headers confirmed: `openai-organization`, `openai-processing-ms`,
  `openai-version`.

### 2.3 Streaming — Responses API event sequence

Confirmed event-type list (from the streaming-responses guide's own SDK example plus the guide
text; per-event payload shape and the exact "usage only at completion" claim could not be
independently pulled from the reference page itself, which is UNVERIFIED against the schema proper
though consistent with documented behavior and the general Responses API design):

```
response.created
response.in_progress
response.output_item.added
response.content_part.added
response.output_text.delta
response.output_text.annotation.added
response.text.done                      (final text for a content part)
response.refusal.delta / .done
response.function_call_arguments.delta / .done
response.file_search_call.in_progress / .searching / .completed
response.code_interpreter.in_progress
response.code_interpreter_call.code.delta / .done
response.code_interpreter_call.interpreting / .completed
response.content_part.done
response.output_item.done
response.completed
response.failed
response.incomplete
error                                     (top-level SSE error event)
```

- `response.function_call_arguments.delta` streams `arguments` as accumulating partial-JSON string
  fragments (mirrors Anthropic's `input_json_delta` — parse only once `.done` fires).
- **UNVERIFIED (docs didn't render the field-by-field schema)**: whether `usage` appears ONLY on
  `response.completed` or also as a running estimate earlier. Given `usage` lives on the top-level
  `Response` object and `response.completed` is the only event that carries the FULL final
  `Response` object, the practical answer is almost certainly "usage is only meaningful/final at
  `response.completed`" — but B1 should not hardcode an assumption about intermediate events
  carrying no usage at all without testing against a live stream.
- `incomplete_details.reason` enum (confirmed): `max_output_tokens`, `max_messages`,
  `content_filter`, `steered` (the last is new — a client sent a `response.steer` event over a
  WebSocket-style connection and the server queued a successor response).

### 2.4 Chat Completions streaming (the older, still-dominant format)

Not independently re-fetched (out of scope given Responses API is OpenAI's current direction per
the brief's own framing "Responses API, then Chat Completions") but well-established and consistent
with the OpenAI-compatible shape OpenRouter documents in §4: newline-delimited `data: {...}` SSE
chunks, each a partial `ChatCompletionChunk` with `choices[].delta` (role/content/tool_calls
incrementally), a final chunk with `choices[].finish_reason` set and (if
`stream_options: {include_usage: true}` was requested) a trailing chunk whose `choices` is EMPTY and
whose `usage` carries the final totals, followed by the literal line `data: [DONE]`.

### 2.5 Tool use / function calling (Responses API shape)

- Tool declaration: `{"type": "function", "name", "description", "parameters": <JSON Schema>,
  "strict": true}`. Same strict-mode rules as OpenAI's structured outputs:
  `additionalProperties: false`, every property in `required` (optional fields expressed as
  `["type", "null"]` unions rather than omission from `required`).
- Model's call: an output item `{"type": "function_call", "id", "call_id", "name", "arguments":
  "<JSON string>"}` — note TWO ids (`id` for the item, `call_id` for pairing with your result).
- Sending results back: `{"type": "function_call_output", "call_id", "output": "<string>"}`.
- Parallel tool calls are the default; `parallel_tool_calls: false` forces at most one per turn.

### 2.6 Prompt caching (OpenAI)

- **Automatic, no `cache_control` needed** for most models. GPT-5.6+ uses "implicit mode" by
  default (breakpoint auto-placed at the end of the latest eligible message); explicit
  developer-controlled caching also exists as an opt-in for finer placement.
- Minimum cacheable prefix: **1,024 visible input tokens for GPT-5.6+**; earlier models vary by
  request shape (tools/images/schemas/reasoning-effort/verbosity all affect the threshold —
  no single number documented for the older generation).
- Reporting: `usage.input_tokens_details.cached_tokens` (read) and, GPT-5.6+ only,
  `.cache_write_tokens` (write).
- TTL: GPT-5.6+ caches live "at least 30 minutes after the latest write or reuse" (may persist
  longer, undocumented ceiling). Earlier models: `in_memory` (~5–10 min idle, up to 1h) or an
  opt-in `24h` tier (~30 min typical, up to 24h max).
- Pricing: cache reads at 0.1× base input (90% discount) universally; cache WRITES are free on
  pre-5.6 models but cost 1.25× base input on GPT-5.6+ — i.e. GPT-5.6+ introduced a write charge
  that didn't exist before. Net effect quoted directly: "writing a prefix once and fully reusing it
  once costs 1.35× its ordinary input cost, compared with 2× for processing it twice without
  caching."

### 2.7 Rate limits — response headers

`x-ratelimit-limit-requests`, `-remaining-requests`, `-reset-requests`, `-limit-tokens`,
`-remaining-tokens`, `-reset-tokens`, plus project-scoped variants
`x-ratelimit-{limit,remaining,reset}-project-tokens` (present only when a project-level token cap
applies). `Retry-After` (capitalized in the docs' own header table) on 429/503.

### 2.8 Errors — taxonomy and retry guidance

| HTTP | Meaning (confirmed) | Retryable |
|---|---|---|
| 400 | invalid `service_tier` / bad request | No |
| 401 | invalid auth / bad key / not org member / IP not authorized | No |
| 403 | country/region/territory not supported | No |
| 429 | credit exhausted / rate limit / `slow_down` / spend or usage limits | Yes — honor `Retry-After`, else exponential backoff+jitter |
| 500 | server error during processing | Yes |
| 503 | model temporarily overloaded | Yes — honor `Retry-After` |

Explicit guidance: on sustained high traffic (≥1M TPM), ramp request rate by "no more than 50%
every 15 minutes" to avoid the `slow_down` 429 variant. **Billing/quota errors are NOT fixed by
retrying** — "Retrying billing, spend, or quota errors won't restore API access." The full JSON
error-object schema (code/type/param nesting) did not render through fetch; only field NAMES
(`error.code`, `error.type`, `error.param`) were confirmed, not the complete shape — flag as
partially UNVERIFIED, cross-check against a live error before hardcoding a parser.

### 2.9 Stop / finish reasons

Chat Completions `finish_reason`: `stop`, `length`, `tool_calls`, `content_filter`,
`function_call` (deprecated legacy form, pre-dates the `tool_calls` array). Responses API uses
`status` (`in_progress`/`completed`/`incomplete`) plus `incomplete_details.reason` (§2.3) rather
than a single finish-reason enum — structurally different from both Anthropic and Chat Completions.

---

## 3. Google Gemini

Primary sources (accessed 2026-09-20): `ai.google.dev/api/generate-content`,
`ai.google.dev/gemini-api/docs/{function-calling,caching,rate-limits,api-errors,thinking,text-generation}`.

**Note on doc churn**: Google's docs currently mix two API surfaces — the long-standing
`generateContent`/`streamGenerateContent` REST methods (camelCase field names, the ones covered
below) and a newer "Interactions API" (snake_case fields like `total_thought_tokens`,
`thinking_level`, step-based `step.delta` streaming) that some guide pages have already migrated
their examples to. Treat the snake_case names as belonging to a DIFFERENT, newer surface, not as
an alternate spelling of the fields below — B1 should target `generateContent` unless a later pass
confirms which surface the SDK ships against.

### 3.1 Usage accounting

`GenerateContentResponse.usageMetadata` (confirmed field names from the API reference):

```json
"usageMetadata": {
  "promptTokenCount": 0,
  "cachedContentTokenCount": 0,
  "candidatesTokenCount": 0,
  "toolUsePromptTokenCount": 0,
  "thoughtsTokenCount": 0,
  "totalTokenCount": 0,
  "promptTokensDetails": [ { "modality": "TEXT", "tokenCount": 0 } ],
  "cacheTokensDetails": [ { "modality": "TEXT", "tokenCount": 0 } ],
  "candidatesTokensDetails": [ { "modality": "TEXT", "tokenCount": 0 } ],
  "toolUsePromptTokensDetails": [ { "modality": "TEXT", "tokenCount": 0 } ],
  "serviceTier": "..."
}
```

- **`promptTokenCount`** is the prompt total — UNVERIFIED from the fetched pages whether it
  INCLUDES `cachedContentTokenCount` (Gemini's caching guide is silent on this specific point,
  unlike OpenAI's explicit cache-hit-rate formula). Given `cachedContentTokenCount` is documented
  as a separate top-level sibling rather than nested under a `*Details` breakdown of
  `promptTokenCount`, and Gemini's cache is a distinct resource-backed mechanism (see §3.5) rather
  than an in-band prefix match, the more likely reading is that `promptTokenCount` counts ALL
  prompt tokens (cached or not) and `cachedContentTokenCount` is an informational subset — but this
  is inference, not a confirmed doc statement. **Verify empirically before billing off it.**
- **`thoughtsTokenCount`** — thinking/reasoning tokens, reported as its OWN top-level counter,
  siblings with `candidatesTokenCount` rather than nested inside it. The thinking-specific guide
  states response pricing is "the sum of output tokens and thinking tokens" — i.e., for Gemini,
  thinking tokens are BILLED SEPARATELY and ADDITIONALLY, the opposite trap-shape from OpenAI
  (where reasoning tokens are a sub-count already inside `output_tokens`). **This is the single
  most important cross-provider trap in this whole survey**: the identical operation (counting
  "how many tokens did reasoning cost") is a sub-count on OpenAI and an ADDITIONAL top-level count
  on Gemini. A canonical `reasoning` field must document, per provider, whether it is already
  folded into `output`/`candidates` or must be added on top.
- **`toolUsePromptTokenCount`** — extra input tokens spent on tool-call scaffolding, again a
  sibling count, not nested inside `promptTokenCount`.
- Per-modality breakdowns (`promptTokensDetails[]` etc.) are ARRAYS of `{modality, tokenCount}`
  pairs (text/image/audio/video), not a flat object — different shape from both Anthropic's nested
  object and OpenAI's `*_details` object.
- **`totalTokenCount`** exists and is presumably the grand sum across prompt + candidates (+
  thoughts + tool-use?) — UNVERIFIED exact composition from the fetched schema fragment; the
  reference page's enumeration didn't include a formula.

### 3.2 Request identity

- **No documented request-id / correlation-id response header was found.** Searched the Gemini API
  error/troubleshooting docs and the general web; nothing analogous to Anthropic's `request-id` or
  OpenAI's `x-request-id` surfaced. Authentication uses `x-goog-api-key` (a REQUEST header, not a
  response one). **Flag this as a genuine capability gap**: if B1 needs to correlate a Gemini call
  with vendor support, there may be no first-class mechanism — this needs a follow-up check against
  raw HTTP response headers from a live call (this task was told not to make real API requests, so
  it is left as an open item, not a confirmed absence).

### 3.3 Streaming

`streamGenerateContent?alt=sse` returns a stream of full `GenerateContentResponse` JSON objects (not
deltas of a different, smaller event-type schema the way Anthropic/OpenAI define separate event
types) — i.e. Gemini's is the simplest of the three: each SSE `data:` line is a candidate
GenerateContentResponse fragment. **UNVERIFIED from the docs**: whether `usageMetadata` appears on
every chunk (cumulatively) or only the last one — the reference page defines the field but does not
state its distribution across a stream. This needs live-stream verification before B1 relies on any
particular chunk carrying final usage.

### 3.4 Tool use / function calling

- Declaration: `{"type": "function", "name", "description", "parameters": <OpenAPI-subset schema>}`
  passed inside a `tools` array (Gemini's REST-level `FunctionDeclaration` shape; the JSON dialect
  fetched from the guide mirrors OpenAI's rather than Anthropic's `input_schema` naming).
  UNVERIFIED whether the raw REST field is literally `parameters` at the top of a `tools[].{...}`
  entry the way `generateContent`'s `Tool.functionDeclarations[]` array is structured, since the
  fetched guide's JSON examples are simplified/SDK-flavored rather than the literal wire body —
  cross-check against `ai.google.dev/api/generate-content#Tool` before hardcoding.
- Model's call arrives as a `functionCall` part: `{"functionCall": {"name", "args": {...}}}` — args
  is already a parsed OBJECT here, not a string needing JSON.parse (different from both Anthropic's
  streamed partial-JSON-then-object and OpenAI's always-a-string `arguments`).
  UNVERIFIED whether there's also an id/callId field for pairing multiple parallel calls in one
  turn — not surfaced in the fetched content.
  Note: `functionResponse` (`function_response` in the SDK helper example above) is the correct
  wire term to send results back, not the SDK-example's `function_result` label that appeared in
  the extraction — treat the extraction's `"type": "function_result"` shape as a paraphrase, not a
  verified literal field name; the canonical REST part type is `functionResponse`.
- **Parallel/multiple function calls**: supported when calls are independent; steering it is
  through `tool_choice`/`function_calling_config` mode `ANY` per the older Gemini API, though the
  fetched guide phrased it as `"tool_choice": "any"` inside `generation_config` — again, treat as a
  paraphrase pending a direct check of `FunctionCallingConfig.mode`.

### 3.5 Caching (Gemini)

Two distinct mechanisms, and mixing them up is itself a trap:
- **Implicit caching** — automatic, on by default for Gemini 2.5+ models, no API call required to
  set up. Minimum tokens to activate: 2,048 for Gemini 2.5 models, 4,096 for newer models (e.g.
  Gemini 3.8 Flash per the fetched guide — model names/thresholds will keep shifting, re-verify per
  release). Reported via `cachedContentTokenCount` in `usageMetadata` (SDK surfaces this as
  `usage.total_cached_tokens` in some client libraries per the fetched text, a RENAMED view of the
  same REST field — don't treat `total_cached_tokens` as a distinct wire field).
- **Explicit caching** — a separate, resource-backed mechanism: you create a named `CachedContent`
  object via its own API call and reference it by resource name in later requests, giving you
  control over TTL. Documented as **NOT supported on the newer "Interactions API"** — i.e. explicit
  caching may be REST/`generateContent`-only going forward.
- TTL for explicit caching was not found in the fetched pages (the caching guide's returned excerpt
  didn't cover it) — UNVERIFIED, needs a direct fetch of the CachedContent resource reference.
- Pricing: "cost savings passed on automatically" on a cache hit — exact discount multiplier NOT
  stated numerically in the fetched excerpt (unlike Anthropic's precise 0.1×/1.25×/2.0× table and
  OpenAI's 0.1×/1.25× figures). Needs a follow-up fetch of the Gemini pricing page specifically.

### 3.6 Rate limits

Three dimensions: **RPM** (requests/minute), **TPM** (tokens/minute, input-side), **RPD**
(requests/day, resets at midnight Pacific). **No rate-limit response headers were found
documented** (unlike Anthropic's `anthropic-ratelimit-*` and OpenAI's `x-ratelimit-*` families) —
a genuine capability gap worth flagging for B1: Gemini rate-limit state may not be introspectable
from response headers at all, only from the 429 itself.

### 3.7 Errors

JSON error shape confirmed as simple: `{"error": {"code": "...", "message": "..."}}` — `code` here
is a **string** (snake_case machine identifier like `rate_limit_exceeded`), not the numeric HTTP
status, and `error.status`/`error.details` (the classic Google Cloud API error envelope) were
**not** confirmed present in the fetched content, despite Gemini generally being described
elsewhere as gRPC-status-shaped — flag as UNVERIFIED/possibly outdated framing; the fetched
`api-errors` page's own excerpt showed a flatter shape than the traditional Google Cloud
`{error:{code,message,status,details[]}}` envelope. HTTP code table (confirmed): 400
(`invalid_request`/`failed_precondition`/`parameter_unknown`), 401 (`authentication`), 402
(`payment_required`), 403 (`permission_denied`), 404 (`not_found`/`model_not_found`), 409
(`already_exists`/`aborted`), 429 (`rate_limit_exceeded`/`quota_exceeded`/`too_many_requests`),
500–504 (`api_error`/`unimplemented`/`service_unavailable`/`deadline_exceeded`). Retry guidance
(confirmed, verbatim from troubleshooting page): retry on `429`, `408`, `5xx`; do NOT retry `400`,
`402`, `403`. **No request-id/correlation-id field found in the error body** — consistent with the
§3.2 gap.

### 3.8 Stop / finish reasons

`FinishReason` enum (confirmed list): `FINISH_REASON_UNSPECIFIED`, `STOP`, `MAX_TOKENS`, `SAFETY`,
`RECITATION`, `LANGUAGE`, `OTHER`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`,
`MALFORMED_FUNCTION_CALL`, `IMAGE_SAFETY`, `UNEXPECTED_TOOL_CALL`. This is a much larger, more
granular safety-oriented enum than either Anthropic's or OpenAI's — treat "safety stop" as needing
its own branch per one of six distinct sub-reasons (`SAFETY`/`RECITATION`/`BLOCKLIST`/
`PROHIBITED_CONTENT`/`SPII`/`IMAGE_SAFETY`) rather than one generic refusal code.

### 3.9 Thinking / reasoning parameters

Two parameter generations documented: an integer **`thinkingBudget`** (token budget, Gemini 2.5-era,
per longstanding Gemini API convention — NOT independently re-confirmed in this pass, carried over
from general knowledge, mark UNVERIFIED-this-session) vs. an effort-style **`thinking_level`**
(`low`/`medium`/`high`, newer models, confirmed from the fetched thinking guide). Thought summaries
(`thinking_summaries: "auto"|"none"`) are optional and DISTINCT from a `signature`-equivalent: the
guide states an encrypted reasoning-state signature is "always present, even when the model
performs minimal reasoning," while the human-readable summary is separately gated. Billing is on
the FULL internal thought token count regardless of how much summary text you were given.

---

## 4. OpenRouter

Primary sources (accessed 2026-09-20): `openrouter.ai/docs/use-cases/usage-accounting`,
`.../api-reference/streaming`, `.../api-reference/errors`, `.../features/prompt-caching`,
`.../api-reference/overview`. (`.../features/tool-calling` 404'd at that exact path in this pass;
confirmed via search that the current path is `openrouter.ai/docs/guides/features/tool-calling`,
not independently re-fetched this session — treat the tool-calling section below as corroborated
by the errors/streaming/overview pages' own OpenAI-compatibility statements rather than a direct
fetch of that specific page.)

### 4.1 Usage accounting

OpenRouter normalizes to (and extends) the OpenAI Chat Completions shape. **As of the fetched docs,
`usage: {include: true}` is no longer needed — usage is now ALWAYS included automatically**
(a documented behavior change from an earlier opt-in design; if B1's spec still says "opt in via
`usage.include`", that's stale).

```json
"usage": {
  "prompt_tokens": 0,
  "completion_tokens": 0,
  "total_tokens": 0,
  "cost": 0,
  "prompt_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 0, "audio_tokens": 0 },
  "completion_tokens_details": { "reasoning_tokens": 0 },
  "cost_details": { "upstream_inference_cost": 0 }
}
```

- **`cost`** — OpenRouter-specific: total CREDITS charged to the caller's account (their own
  markup/routing fee included). **`cost_details.upstream_inference_cost`** — the actual cost the
  underlying provider charged OpenRouter, separate from what you were billed. This pairing is
  unique to OpenRouter among the five providers surveyed — no other provider reports "what the
  upstream actually cost" as a distinct number.
- Streaming: usage is on the LAST SSE message only (confirmed: "included in the last SSE message
  for streaming responses, or in the complete response for non-streaming requests") — same pattern
  as OpenAI's `stream_options.include_usage` trailing empty-choices chunk.
- A `cache_discount` field is also mentioned (total savings per request) — a convenience derived
  figure, not a primary counter.

### 4.2 Request identity

- Response `id` is `gen-`-prefixed (e.g. `gen-xxxxxxxxxxxxxx`) — this differs from every upstream
  provider's own id format, since OpenRouter mints its own generation id regardless of which
  backend served the request.
- **No dedicated response HEADER for request/correlation id was found documented** in the fetched
  overview page (only request-side app-identification headers `HTTP-Referer`/`X-OpenRouter-Title`
  were covered there) — flag as UNVERIFIED/possible gap, follow up against a live response.
  Error-response error IDs are `gen-`-prefixed when a generation attempt started; **pre-routing
  errors can have a `null` id in some API "skins" (e.g. the Anthropic-Messages-compatible skin)** —
  a documented, deliberate inconsistency worth handling defensively (id may be `null`).

### 4.3 Streaming

OpenAI-compatible SSE: `data: {...}` chunks with `choices[].delta`, tool calls streamed via
`delta.tool_calls[]` indexed by array position (mirrors OpenAI exactly), terminated by literal
`data: [DONE]`. **Two OpenRouter-specific wrinkles**:
- **Keep-alive comment lines**: `: OPENROUTER PROCESSING` (an SSE comment, i.e. a line starting
  with `:`) sent periodically to prevent proxy/connection timeouts. **A client that blindly
  `JSON.parse()`s every `data:`-adjacent line without first stripping/ignoring comment lines will
  crash its stream loop** — this is an explicit documented gotcha.
- **Mid-stream errors arrive as HTTP 200 + an in-band error field**, not a separate SSE `event:
  error` the way Anthropic does it: `data: {"id":"...", ..., "error": {"code","message"},
  "choices":[{"delta":{"content":""}, "finish_reason":"error"}]}`. The trap: HTTP status stays 200
  the whole time, so status-code-based error handling will miss this entirely — must inspect the
  chunk body for a top-level `error` key AND treat `finish_reason: "error"` as terminal-with-failure.

### 4.4 Tool use

OpenAI-compatible function-calling JSON shape end to end (tool declaration, `tool_calls[]` in the
response, `role: "tool"` messages carrying results) — OpenRouter's stated design goal is exactly
"standardize the interface across providers, so agents can keep one integration," including for
non-OpenAI backends like Anthropic/Gemini models routed through it. This means: **if B1 ever routes
through OpenRouter instead of calling Anthropic directly, the wire shape it sees is OpenAI's, not
Anthropic's** — the provider-specific traps in §1/§3 are normalized away (and also HIDDEN — you
lose visibility into, e.g., Anthropic's per-TTL cache breakdown, which has no OpenAI-shaped
equivalent).

### 4.5 Prompt caching (via OpenRouter, cross-provider)

OpenRouter's own mechanism for making caching work despite routing across multiple raw provider
accounts: **sticky provider routing** — subsequent requests are pinned to the same upstream
provider endpoint for up to 10 minutes of inactivity so a would-be cache hit has somewhere to land;
an explicit `session_id` param (≤256 chars) can pin this deliberately instead of relying on
implicit stickiness.
- Automatic (no config) on: OpenAI, DeepSeek, Grok, Moonshot, Groq, Z.AI, and Gemini 2.5+ (implicit
  caching, per §3.5).
- Manual `cache_control` breakpoints required on: **Anthropic Claude** (same `{"type":"ephemeral"}`
  shape as direct API, same 5m/1h TTL choice), **Alibaba Qwen**, and — per the fetched page —
  **Google Gemini also listed under "manual breakpoint" providers** for OpenRouter specifically,
  which appears to CONTRADICT §3.5's "Gemini 2.5+ implicit by default" and is worth flagging as an
  internal inconsistency in OpenRouter's own docs (possibly: implicit caching is Google-side
  automatic, but OpenRouter's PASS-THROUGH of an explicit breakpoint is a separate opt-in surfaced
  for parity with Anthropic's request shape) — treat as UNVERIFIED which of the two claims governs
  actual billing behavior when routing Gemini through OpenRouter.
- Reporting is uniformly `prompt_tokens_details.{cached_tokens, cache_write_tokens}` +
  `cache_discount`, REGARDLESS of upstream provider — i.e. OpenRouter normalizes Anthropic's
  nested-TTL cache breakdown down to the same two flat numbers it uses for everyone else, so the
  per-TTL granularity (§1.5) is LOST if you go through OpenRouter instead of calling Anthropic
  directly.
- Cache-read discount range across providers, per the fetched page: 0.1× (DeepSeek, Anthropic) to
  0.5× (Groq) of base input price; cache-write cost ranges from free (OpenAI, Grok, Moonshot) up to
  1.25× (Anthropic 5m TTL, Alibaba).

### 4.6 Errors

| HTTP | Meaning |
|---|---|
| 400 | invalid/missing params, CORS |
| 401 | invalid credentials (expired OAuth session, disabled/invalid key) |
| 402 | insufficient credits |
| 403 | insufficient permissions / guardrail block / moderation flag |
| 408 | request timeout |
| 429 | rate limited — `Retry-After` header present |
| 502 | chosen model is down, or an invalid upstream response was received |
| 503 | no available provider meets routing requirements |

Body: `{"error": {"code": <number, matches HTTP status>, "message": "...", "metadata"?: {...}}}`.
A **moderation-specific** `metadata` shape is documented: `{"reasons": string[], "flagged_input":
string (≤100 chars, truncated with "…"), "provider_name": string, "model_slug": string}` — useful
for surfacing WHY a 403 fired without re-deriving it.

### 4.7 Response shape / providers

`id` (`gen-` prefixed), `choices`, `created`, `model` (carries the `org/model` slug, e.g.
`anthropic/claude-sonnet-4.6`, used AS the provider-attribution field — there is no separate
`provider` field in the response body), `object`, optional `system_fingerprint`, `usage`.

---

## 5. Ollama

Primary source (accessed 2026-09-20): `github.com/ollama/ollama/blob/main/docs/api.md` (raw).

### 5.1 Usage accounting

No token-cost concept (local/self-hosted, no billing) — but full token/timing accounting is still
reported on both `/api/generate` and `/api/chat` responses:

```json
{
  "model": "...", "created_at": "...", "done": true, "done_reason": "stop",
  "total_duration": 0, "load_duration": 0,
  "prompt_eval_count": 0, "prompt_eval_cached_count": 0, "prompt_eval_duration": 0,
  "eval_count": 0, "eval_duration": 0
}
```
Plus, per endpoint: `/api/generate` → `response` (full text when non-streaming) + `context` (an
opaque conversation-state encoding for follow-up calls); `/api/chat` → `message: {role, content,
images, tool_calls}`.

- **All durations are in NANOSECONDS** (`total_duration`, `load_duration`, `prompt_eval_duration`,
  `eval_duration`) — a real trap if a canonical shape assumes milliseconds; divide by 1e9 for
  seconds, or 1e6 for ms.
- **`prompt_eval_count` ≈ Anthropic's/OpenAI's input tokens; `eval_count` ≈ output tokens.**
  `prompt_eval_cached_count` is Ollama's own local KV-cache-hit counter — there is no monetary
  discount (local compute), but it IS the closest analog to `cache_read_input_tokens` /
  `cached_tokens` for latency/throughput purposes.
- **There is no `total_tokens` field** — sum `prompt_eval_count + eval_count` yourself, same
  omission pattern as Anthropic.
- **No separate reasoning/thinking token count** was found documented for Ollama's own API surface
  (models that support thinking, e.g. served via Ollama, would presumably surface it inside
  `message.content` or a `thinking` field on the message rather than a counted usage sub-field —
  UNVERIFIED, not covered in the fetched api.md excerpt).

### 5.2 Request identity

**None.** No request-id concept, no correlation header — confirmed absence, consistent with
Ollama being a local/self-hosted server rather than a multi-tenant cloud API. There is nothing to
extract here beyond "does not exist by design."

### 5.3 Streaming

Simplest of all five: when `"stream": true` (the default), the HTTP response body is a sequence of
**newline-delimited JSON objects** (NDJSON, not SSE — no `event:`/`data:` framing, no `[DONE]`
sentinel) — each object is a PARTIAL result with `done: false` until the terminal object, which
carries `done: true` plus the full duration/count accounting from §5.1. `"stream": false` collapses
this to a single JSON object equivalent to the terminal chunk.

### 5.4 Tool use

Request: a `tools` array in the same OpenAI-style function-schema shape. Response:
`message.tool_calls[]`, each `{"function": {"name", "arguments"}}` — UNVERIFIED from the fetched
excerpt whether `arguments` here is a JSON STRING (OpenAI-style) or an already-parsed OBJECT
(Gemini-style); the extraction did not preserve that distinction. Given Ollama's Chat API is
explicitly modeled on OpenAI's shape elsewhere, the string form is the more likely reading, but
this should be confirmed against a live response before B1's parser assumes either.

### 5.5 Caching / rate limits / errors / stop reasons

- **No prompt-caching feature analogous to the cloud providers** — Ollama's `prompt_eval_cached_count`
  is an automatic local KV-cache observation, not something you opt into or control via request
  parameters.
- **No rate limits, no rate-limit headers** — single local server, caller controls concurrency.
- **No documented error taxonomy/error-object schema** was found in the fetched api.md — errors are
  presumably plain HTTP status + a message body but the exact shape was not covered in this fetch;
  UNVERIFIED, would need a targeted fetch of Ollama's error-handling section if one exists (not
  surfaced in the excerpt returned).
- **`done_reason` values (confirmed)**: `stop`, `length`, `load` (response is only a model-load
  event — no generation happened), `unload` (a request that unloads a model, e.g. an empty prompt
  with `keep_alive: 0`). Notably `load`/`unload` aren't "stop reasons" in the same sense as the
  other providers' enums — they're OPERATIONAL states Ollama reuses the same field to report,
  which a canonical `stopReason` type will need to special-case as "not actually a generation
  outcome" rather than folding into the same enum as `stop`/`length`.

---

## 6. Comparison table — canonical shape mapping

`{input, output, cacheRead, cacheWrite, reasoning?, requestId, model, stopReason}`

| Canonical field | Anthropic | OpenAI (Responses) | OpenAI (Chat Completions) | Gemini | OpenRouter | Ollama | Lost/ambiguous |
|---|---|---|---|---|---|---|---|
| `input` | `usage.input_tokens` (EXCLUDES cache; add `cache_creation_input_tokens + cache_read_input_tokens` for the true total) | `usage.input_tokens` (INCLUDES `cached_tokens` as sub-count) | `usage.prompt_tokens` (INCLUDES `prompt_tokens_details.cached_tokens`) | `usageMetadata.promptTokenCount` (inclusion of cache UNVERIFIED) | `usage.prompt_tokens` (OpenAI semantics) | `prompt_eval_count` | Anthropic's "input excludes cache" is the ONE outlier — every other provider's "input" already includes its cache sub-count |
| `output` | `usage.output_tokens` (INCLUDES thinking, no separate count exists) | `usage.output_tokens` (INCLUDES `reasoning_tokens` as sub-count) | `usage.completion_tokens` (INCLUDES `completion_tokens_details.reasoning_tokens`) | `usageMetadata.candidatesTokenCount` (EXCLUDES `thoughtsTokenCount` — separate top-level sibling) | `usage.completion_tokens` (OpenAI semantics) | `eval_count` | Gemini is the ONE outlier here — reasoning is ADDITIVE on top of `candidatesTokenCount`, not folded in |
| `cacheRead` | `usage.cache_read_input_tokens` (+ per-TTL breakdown not separately exposed for reads) | `usage.input_tokens_details.cached_tokens` | `usage.prompt_tokens_details.cached_tokens` | `usageMetadata.cachedContentTokenCount` | `usage.prompt_tokens_details.cached_tokens` | `prompt_eval_cached_count` (no cost meaning, latency-only) | Ollama's version carries no monetary discount — same field name, different meaning class |
| `cacheWrite` | `usage.cache_creation_input_tokens` (+ `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` per-TTL breakdown — UNIQUE to Anthropic) | `usage.input_tokens_details.cache_write_tokens` (GPT-5.6+ only; UNVERIFIED on older models) | not exposed (writes are usually free/automatic pre-5.6, no counter) | not clearly separated from `promptTokenCount` in the fetched schema | `usage.prompt_tokens_details.cache_write_tokens` | none | Anthropic is the only provider with a queryable PER-TTL write breakdown; everyone else gives at most one flat write number or none |
| `reasoning` | none (folded into `output`, no field name exists) | `usage.output_tokens_details.reasoning_tokens` (sub-count) | `usage.completion_tokens_details.reasoning_tokens` (sub-count) | `usageMetadata.thoughtsTokenCount` (ADDITIONAL top-level count, billed separately) | `usage.completion_tokens_details.reasoning_tokens` (OpenAI semantics) | none documented | Direction of inclusion (sub-count vs additive) DIFFERS between OpenAI-family and Gemini — this is the single biggest cross-provider trap in the whole survey |
| `requestId` | HTTP header `request-id`; body `request_id` on errors only | HTTP header `x-request-id` | HTTP header `x-request-id` | **not found documented** | body `id` (`gen-` prefixed; may be `null` pre-routing); no header found | **does not exist** | Gemini and Ollama both lack a confirmed correlation mechanism; every provider uses a DIFFERENT header name where one exists at all |
| `model` | `model` (top-level, may differ from requested if server-side fallback occurred — see `fallback` content blocks) | `model` | `model` | not surfaced in the fetched `usageMetadata` fragment (presumably top-level `model` sibling per GenerateContentResponse; UNVERIFIED) | `model` (`org/model` slug, doubles as provider attribution) | `model` | Nothing unusual here except Anthropic's documented server-side-fallback case, where the serving model can legitimately differ from the requested one mid-response |
| `stopReason` | `stop_reason`: 7 values incl. `pause_turn` (server-tool continuation, distinct from `tool_use`) and `refusal` (with `stop_details.category`) | Responses: `status` + `incomplete_details.reason` (4 values); Chat Completions: `finish_reason` (5 values) | (see left) | `finishReason`: 13 values, 6 of them safety-specific sub-reasons | mirrors whichever upstream `finish_reason` shape + own `finish_reason: "error"` for mid-stream failures | `done_reason`: `stop`/`length` are real stop reasons; `load`/`unload` are OPERATIONAL states reusing the same field | Every provider's enum has a different SHAPE (Anthropic: flat 7-value; OpenAI Responses: two-field; Gemini: flat but 13-value and safety-heavy; Ollama: mixes generation outcomes with server lifecycle events) |

---

## 7. TRAPS — everywhere a naive sum double-counts or a name means something different

1. **Reasoning tokens: sub-count vs. additive, and it FLIPS between OpenAI-family and Gemini.**
   OpenAI/OpenRouter: `reasoning_tokens` is already inside `output_tokens`/`completion_tokens` —
   adding it again doubles the reasoning cost. Gemini: `thoughtsTokenCount` is a SEPARATE top-level
   counter, NOT inside `candidatesTokenCount` — omitting it UNDER-counts real output cost and
   under-bills, since the docs state pricing is the SUM of the two. Anthropic: no separate field
   exists at all; thinking tokens are invisibly inside `output_tokens` with no way to isolate them.
   **A canonical `reasoning` field needs a per-provider flag for "is this additive or already
   included," not just the number.**

2. **`input`/`prompt` tokens: Anthropic EXCLUDES cache counters, everyone else INCLUDES them.**
   Summing `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` is REQUIRED for
   Anthropic to get a true total, but doing the equivalent sum for OpenAI/OpenRouter/Chat
   Completions DOUBLE-COUNTS, since their `input_tokens`/`prompt_tokens` already include the cached
   sub-count. A generic "always add cache counters to input" helper will be right for one provider
   and wrong for the rest.

3. **Streaming `usage` is cumulative in `message_delta` (Anthropic) and final-chunk-only
   (OpenAI/OpenRouter Chat-Completions-style, when `include_usage` is requested) — but Anthropic's
   `message_start` ALSO carries a non-final `output_tokens` (an early estimate, observed as low as
   1–3 in the docs' own examples).** Summing every streamed usage object across the whole SSE
   transcript over-counts for Anthropic (the deltas are already cumulative, not incremental) and
   is simply WRONG for OpenAI (only the trailing chunk has real numbers; intermediate chunks may
   have none at all under the older Chat Completions API unless `stream_options.include_usage` was
   set). **Rule: take the LAST usage object you see per provider's own documented cumulation
   semantics — never sum across chunks.**

4. **Ollama's durations are nanoseconds; everyone else's timing (where present at all) is typically
   milliseconds or seconds.** A shared "durationMs" field needs an explicit `/1e6` conversion for
   Ollama alone.

5. **OpenRouter's mid-stream errors are HTTP 200 with an in-band `error` field and
   `finish_reason: "error"`** — status-code-based retry/error logic will silently treat a failed
   generation as a successful one unless the chunk body is inspected. Anthropic's mid-stream errors
   ARE distinguishable as their own `event: error` SSE event type, a materially easier signal to
   catch. Gemini's/Ollama's mid-stream error behavior was not confirmed in this pass (UNVERIFIED).

6. **Anthropic's `pause_turn` is not `tool_use`.** A harness that treats every non-`end_turn` stop
   reason as "needs more work, resend" without branching on `pause_turn` vs `tool_use` will send
   the WRONG continuation shape — `pause_turn` wants the assistant content re-sent as-is with the
   same `tools` array (server continues an interrupted server-tool loop); `tool_use` wants you to
   inject `tool_result` blocks you computed yourself. Conflating them either drops your tool
   results or double-runs a server tool.

7. **Ollama's `done_reason` mixes generation outcomes (`stop`, `length`) with server lifecycle
   events (`load`, `unload`) in the same enum field** — a canonical `stopReason` type built from
   Ollama responses must filter out `load`/`unload` before treating the field as "why did
   generation end," or a model-load ping will be misread as a truncated response.

8. **Anthropic's spend-cap 429 vs. ordinary rate-limit 429 are the same HTTP status and same
   `error.type` ("rate_limit_error") but behave OPPOSITELY under retry** — the spend-cap variant
   has NO `retry-after` header and will keep failing until the next billing period no matter how
   long you wait or how many times you retry with backoff. The only reliable discriminator is
   `error.details.error_code === "enforced_spend_limit_reached"`. A generic "429 → backoff and
   retry" handler will spin forever against a spend cap.

9. **`total_tokens`/`totalTokenCount` exists for OpenAI, OpenRouter, and Gemini but NOT for
   Anthropic or Ollama** — a canonical shape that always exposes a computed total must derive it
   itself for the latter two rather than assuming the field is universally present on the wire.

10. **Tool-call argument encoding differs across providers at the wire level**: Anthropic streams
    partial-JSON STRING fragments then resolves to a parsed OBJECT in the final `tool_use.input`;
    OpenAI's Responses/Chat APIs keep `arguments` as a JSON STRING even in the non-streaming final
    response (you must `JSON.parse` it yourself always); Gemini's `functionCall.args` is already a
    parsed OBJECT with no string-encoding step at all. A shared "parse tool arguments" helper
    cannot assume string-vs-object uniformly.

---

## 8. WHAT B1 MUST HANDLE ON DAY ONE vs LATER

### Day one (get this wrong and every downstream cost/usage number is silently corrupted)

- **Per-provider input-token composition rule** (trap #2): Anthropic's `input_tokens` excludes
  cache counters; everyone else's includes them. Get the "true total input" formula right per
  provider before computing any cost.
- **Per-provider reasoning-token direction** (trap #1): whether `reasoning`/`thoughts` is additive
  (Gemini) or already-included (OpenAI family, and implicitly Anthropic with no visible field at
  all). This determines correctness of ANY total-cost figure the moment thinking/reasoning models
  are used.
- **Streaming usage cumulation rule** (trap #3): never sum usage across SSE chunks; always take the
  final/most-authoritative one per the provider's own documented semantics (Anthropic:
  last `message_delta`; OpenAI/OpenRouter: the dedicated trailing usage-only chunk, when requested).
- **Request-id extraction, where it exists**: `request-id` header (Anthropic), `x-request-id`
  header (OpenAI, and presumably OpenRouter passes it through or substitutes its own `gen-` id —
  UNVERIFIED which). Needed from day one for support/debugging correlation and for B1's own
  request/response audit log.
- **Stop-reason branching for `tool_use` vs `pause_turn` vs `refusal`** (Anthropic) and
  `finish_reason: "tool_calls"` vs a genuine stop (OpenAI/OpenRouter) — getting this wrong breaks
  the agentic loop itself, not just accounting.
- **Tool-argument parsing per provider's actual encoding** (trap #10): string-that-needs-parsing
  (Anthropic accumulated deltas, OpenAI always) vs. already-an-object (Gemini).
- **Anthropic's `request-id` vs error-body `request_id` vs AWS's dual-id case** — pick ONE canonical
  field name for B1's own log schema and map every provider's variant onto it explicitly, don't
  assume a shared name.
- **Mid-stream error detection**: Anthropic's distinct `event: error`; OpenRouter's HTTP-200-with-
  in-band-error trap (#5) — a generic "if status is 200, the stream succeeded" assumption is wrong
  for OpenRouter specifically.

### Can wait for a later pass

- Gemini's/OpenRouter's exact rate-limit introspection (Gemini apparently has NO rate-limit
  response headers at all — day-one code can just handle 429 blind and back off, refining once/if a
  header-based approach is confirmed possible).
- Per-TTL cache-write breakdown (Anthropic's `cache_creation.ephemeral_5m/1h`) — the flat
  `cache_creation_input_tokens` total is enough for basic cost accounting; the TTL split only
  matters for cache-strategy tuning, not correctness.
- OpenAI's Chat Completions streaming details (re-verify directly rather than relying on the
  OpenAI-compatibility inference from OpenRouter's docs) — Responses API is OpenAI's forward
  direction per the brief anyway.
- Gemini's newer "Interactions API" (`step.delta`, `total_thought_tokens`, `thinking_level`) — note
  its existence, don't build against it until it's clear which surface the actual Gemini SDK
  targets for B1's integration.
- Ollama tool-call `arguments` string-vs-object confirmation, and its (currently undocumented in
  the fetched source) error-response shape — low priority since Ollama has no billing/rate-limit
  surface to get wrong in the meantime, and tool support there is comparatively new.
- Full JSON error-object schema for OpenAI (only field names, not complete shape, were confirmed
  through fetch) and Gemini's `error.status`/`error.details` question — worth a live-response
  cross-check once B1 has an actual test credential, rather than guessed from partially-rendered
  docs.
- Provenance of Anthropic's `cache_creation` nested object's exact presence conditions (always
  present once ANY cache write occurs, vs. only when a 1h write occurs) — a minor completeness
  question that doesn't affect the flat totals already used for cost math.

# zero-agent-sdk

## 0.2.0

### Minor Changes

- [#13](https://github.com/yellinzero/zero-agent-sdk/pull/13) [`e395231`](https://github.com/yellinzero/zero-agent-sdk/commit/e395231de32fcc8322a77b212e6cc8f2378f145e) Thanks [@yellinzero](https://github.com/yellinzero)! - Structured output is now a first-class concern with a single, output-first API.
  This changeset is intended for the `0.2.0-beta` release line before a stable promotion.

  **New surface**

  - `agent.run(prompt, { output })` resolves to `StructuredAgentResult<T>` with a typed and validated `output` field.
  - `agent.stream(prompt, { output })` returns a `StreamOutputResult<TPartial, TFinal, TElement>` exposing `textStream`, `partialOutputStream`, `elementStream` (array outputs only), `fullStream`, `events`, and `output` / `text` / `usage` promises.
  - `fullStream` event names are now `text-delta | object | element | finish | error`, matching the structured-stream contract used by Vercel AI SDK style consumers.
  - `Output.text() | object() | array() | enum() | json()` builds an `OutputDefinition`. Validation is delegated to the underlying Zod schema — no Ajv dependency.
  - `StructuredOutputError` carries `reason` (`parse_failed | schema_mismatch | max_repairs | no_output`), `rawText`, `kind`, `finishReason`, `usage`, `attempts`, and `repairHistory` for diagnostics.
  - `AgentConfig.maxStructuredOutputRepairs` (default `2`) bounds the synthetic-tool repair loop on tool-synthesis providers (Anthropic, Bedrock).
  - Provider structured-output capabilities are now explicit per model family. OpenAI / Azure / Gemini stay native, Anthropic / Bedrock always synthesize, and OpenAI-compatible json-only providers declare `json_object` support without implicitly claiming `json_schema`.

  **Breaking changes**

  - Removed `agent.runWithOutput()` and `agent.streamOutput()` — use the overloaded `agent.run({ output })` / `agent.stream({ output })` instead.
  - Removed `responseFormat` from `AgentConfig` and `RunOptions`. Use `Output.*` to declare structured output, or pass `responseFormat` directly to `provider.streamMessage()` for low-level use.
  - Renamed `Output.choice(...)` to `Output.enum(...)`.
  - `Output.array(...)` no longer silently returns `[]` when the model omits the wrapper — it throws a `StructuredOutputError`.
  - `StructuredAgentResult` now exposes `.output` instead of `.object`.
  - The synthetic structured-output tool delegates validation through `OutputDefinition.validate` (Zod) instead of a JSON-Schema validator.

  **New helpers / types**

  - `formatZodError`, `OutputKind`, `OutputStreamEvent`, `InferOutputElement`, `StructuredOutputErrorReason`, `StructuredOutputErrorContext` are now exported from the package root.

/**
 * `llmRequester` domain — durable request-trace wire Model and Ops.
 *
 * Defines `llm.tools_snapshot` snapshots, `llm.request` outbound request traces
 * and `llm.error` failed-request traces, with replay restoring only the
 * snapshot de-dup cursor. Consumed by the Agent-scope `llmRequester`
 * implementation.
 */

import { z } from 'zod';

import type { ApiErrorKind } from '#/kosong/contract/errors';
import type { ThinkingEffort } from '#/kosong/contract/provider';
import { defineModel } from '#/wire/model';

export interface LlmRequestToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface LlmRequestTraceState {
  readonly seenToolsHashes: readonly string[];
}

export const LlmRequestTraceModel = defineModel<LlmRequestTraceState>(
  'llm.requestTrace',
  () => ({ seenToolsHashes: [] }),
);

const llmToolEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

declare module '#/wire/types' {
  interface PersistedOpMap {
    'llm.tools_snapshot': typeof llmToolsSnapshot;
    'llm.request': typeof llmRequest;
    'llm.error': typeof llmError;
  }
}

export const llmToolsSnapshot = LlmRequestTraceModel.defineOp('llm.tools_snapshot', {
  schema: z.object({
    hash: z.string(),
    tools: z.array(llmToolEntrySchema).readonly(),
  }),
  apply: (s, p) => {
    if (s.seenToolsHashes.includes(p.hash)) return s;
    return { seenToolsHashes: [...s.seenToolsHashes, p.hash] };
  },
});

export const llmRequest = LlmRequestTraceModel.defineOp('llm.request', {
  schema: z.object({
    kind: z.enum(['loop', 'compaction']),
    provider: z.string(),
    model: z.string(),
    modelAlias: z.string().optional(),
    thinkingEffort: z.custom<ThinkingEffort>().optional(),
    thinkingKeep: z.string().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    maxTokens: z.number().optional(),
    betaApi: z.boolean().optional(),
    toolSelect: z.boolean(),
    systemPromptHash: z.string(),
    systemPrompt: z.string().optional(),
    toolsHash: z.string(),
    messageCount: z.number(),
    turnStep: z.string().optional(),
    attempt: z.string().optional(),
    projection: z.enum(['strict', 'media-degraded', 'media-stripped']).optional(),
    droppedCount: z.number().optional(),
  }),
  apply: (s) => s,
});

/**
 * Upper bound on the journaled provider error message. Provider messages are
 * unbounded free text, so they are truncated before they reach the journal.
 */
export const LLM_ERROR_MESSAGE_MAX_LENGTH = 500;

/**
 * A failed outbound request. Journaled for every non-aborted provider failure,
 * retryable or not — notably `quota_exhausted`, which `isRetryableGenerateError`
 * excludes from the retry path, so it never surfaces as `turn.step.retrying`.
 * `kind` carries the same classification as the `api_error` telemetry event, so
 * a reader can tell a transient 429 (`rate_limit`) from a hard quota stop
 * (`quota_exhausted`) without matching on message text.
 */
export const llmError = LlmRequestTraceModel.defineOp('llm.error', {
  schema: z.object({
    kind: z.custom<ApiErrorKind>(),
    statusCode: z.number().optional(),
    retryable: z.boolean(),
    errorName: z.string(),
    message: z.string(),
    model: z.string(),
    modelAlias: z.string().optional(),
    requestKind: z.string().optional(),
    turnId: z.number().optional(),
    step: z.number().optional(),
    durationMs: z.number(),
    traceId: z.string().optional(),
  }),
  apply: (s) => s,
});

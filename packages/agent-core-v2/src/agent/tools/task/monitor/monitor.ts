/**
 * `tools` domain (L7) — `IMonitorTool` contract (the `Monitor` tool).
 *
 * Public contract of the `Monitor` tool (run a self-filtering shell command
 * in the background and receive each new stdout line as a notification): the
 * input zod schema the model-facing parameters are derived from and the
 * `IMonitorTool` DI decorator that the implementation (`monitorTool.ts`)
 * registers against via `registerAgentToolService`. Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const MonitorInputSchema = z.object({
  command: z.string().describe('Shell command to monitor. Each stdout line is an event; self-filter (e.g. grep --line-buffered).'),
  description: z.string().describe('Short description shown in every notification.'),
  timeout_ms: z
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(300000)
    .describe('Kill the monitor after this deadline. Ignored when persistent=true.'),
  persistent: z
    .boolean()
    .default(false)
    .describe('Run for the lifetime of the session (no timeout). Stop with TaskStop.'),
});

export type MonitorInput = z.infer<typeof MonitorInputSchema>;


export interface IMonitorTool extends AgentTool<MonitorInput> { readonly _serviceBrand: undefined }
export const IMonitorTool = createDecorator<IMonitorTool>('monitorTool');

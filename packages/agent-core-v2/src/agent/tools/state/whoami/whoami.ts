/**
 * `tools` domain (L7) — `IWhoamiTool` contract (the `Whoami` tool).
 *
 * Public contract of the `Whoami` tool (report the model the agent is
 * currently running as): the input zod schema the model-facing parameters are
 * derived from and the `IWhoamiTool` DI decorator that the implementation
 * (`whoamiTool.ts`) registers against via `registerAgentToolService`. Bound
 * at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import { type AgentTool } from '#/tool/toolContract';

export const WhoamiInputSchema = z.object({}).strict();

export type WhoamiInput = z.infer<typeof WhoamiInputSchema>;


export interface IWhoamiTool extends AgentTool<WhoamiInput> { readonly _serviceBrand: undefined }
export const IWhoamiTool = createDecorator<IWhoamiTool>('whoamiTool');

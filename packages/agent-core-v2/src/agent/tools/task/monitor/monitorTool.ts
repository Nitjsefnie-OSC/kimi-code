/**
 * `tools` domain (L7) — `MonitorTool` implementation (the `Monitor` tool).
 *
 * Spawns a self-filtering shell command through `ISessionProcessRunner` and
 * hands the process to `IAgentTaskService` (`agentTask` domain) as a detached
 * `MonitorTask` — timeouts, `TaskStop`, and session-close teardown all come
 * from the shared task infrastructure. Each batched stdout line emit is
 * delivered to the model as a `<notification type="monitor_line">` message
 * enqueued onto the agent loop with `activeOrNewTurn` admission (the same
 * admission the terminal task notification uses), and the `task.notified`
 * bus event fires on delivery so the external `Notification` hook sees the
 * line with matcher `monitor_line`. Ported from v1's `MonitorTool`
 * (`packages/agent-core/src/tools/background/monitor.ts`).
 *
 * Registered via the module-level `registerAgentToolService(IMonitorTool,
 * MonitorTool)` at the bottom of this file — the same "import = register"
 * pattern used by every agent tool. Bound at Agent scope.
 */

import { toInputJsonSchema } from '#/tool/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '#/tool/rule-match';
import { type ExecutableToolResult, type ToolExecution } from '#/tool/toolContract';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';

import { IAgentTaskService } from '#/agent/task/task';
import { renderNotificationXml } from '#/agent/task/notificationXml';
import { TaskNotificationStepRequest } from '#/agent/task/taskService';
import { type TaskOrigin } from '#/agent/contextMemory/types';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IEventBus } from '#/app/event/eventBus';
import { IHostEnvironment } from '#/os/interface/hostEnvironment';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionProcessRunner, type IProcess } from '#/session/process/processRunner';

import { IMonitorTool, MonitorInputSchema, type MonitorInput } from './monitor';
import { MonitorTask, type MonitorEmit } from './monitor-task';
import MONITOR_DESCRIPTION from './monitor.md?raw';


export class MonitorTool implements IMonitorTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Monitor' as const;
  readonly description = MONITOR_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MonitorInputSchema);

  private readonly isWindowsBash: boolean;
  private readonly monitorSeqCounters = new Map<string, number>();

  constructor(
    @ISessionProcessRunner private readonly runner: ISessionProcessRunner,
    @IHostEnvironment private readonly env: IHostEnvironment,
    @ISessionContext private readonly ctx: ISessionContext,
    @IAgentTaskService private readonly tasks: IAgentTaskService,
    @IAgentLoopService private readonly loop: IAgentLoopService,
    @IEventBus private readonly eventBus: IEventBus,
  ) {
    this.isWindowsBash = this.env.osKind === 'Windows';
  }

  resolveExecution(args: MonitorInput): ToolExecution {
    return {
      description: `Monitoring: ${args.command}`,
      approvalRule: literalRulePattern(this.name, args.command),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.command),
      execute: async () => this.execution(args),
    };
  }

  private async execution(args: MonitorInput): Promise<ExecutableToolResult> {
    const effectiveCwd = this.ctx.cwd;
    const command = this.isWindowsBash ? rewriteWindowsNullRedirect(args.command) : args.command;

    let proc: IProcess;
    try {
      proc = await this.spawn(effectiveCwd, command);
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
    closeProcessStdin(proc);

    const timeoutMs = args.persistent ? undefined : args.timeout_ms;
    // The emit closure needs the task id, which only exists after
    // registration; registration returns before the task's `start` can emit.
    const taskIdHolder: { taskId: string } = { taskId: '' };
    const emit: MonitorEmit = (lines, severity) => {
      this.monitorNotify(taskIdHolder.taskId, args.description, lines, severity);
    };

    let taskId: string;
    try {
      taskId = this.tasks.registerTask(
        new MonitorTask(proc, command, args.description, emit, {}, timeoutMs),
        { detached: true, timeoutMs },
      );
      taskIdHolder.taskId = taskId;
    } catch (error) {
      // Registration can throw (e.g. maxRunningTasks reached). The process is
      // already spawned and not yet owned by the manager, so clean it up here
      // to avoid orphaning a long-running command — mirrors the Bash path.
      await killSpawnedProcess(proc);
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      isError: false,
      output:
        `task_id: ${taskId}\n` +
        `persistent: ${args.persistent}\n` +
        'Each matching stdout line arrives as a notification. Stop with TaskStop.',
    };
  }

  private monitorNotify(
    taskId: string,
    description: string,
    lines: string[],
    severity: 'info' | 'warning' = 'info',
  ): void {
    const body = lines.join('\n');
    const notification = {
      id: `monitor:${taskId}:${this.nextMonitorSeq(taskId)}`,
      category: 'task',
      type: 'monitor_line',
      source_kind: 'monitor',
      source_id: taskId,
      title: description,
      severity,
      body,
    };
    const origin: TaskOrigin = {
      kind: 'task',
      taskId,
      status: 'running',
      notificationId: `monitor:${taskId}`,
    };
    const request = new TaskNotificationStepRequest(
      {
        role: 'user',
        content: [{ type: 'text', text: renderNotificationXml(notification) }],
        toolCalls: [],
        origin,
      },
      () => {
        this.eventBus.publish({
          type: 'task.notified',
          notificationType: 'monitor_line',
          title: description,
          body,
          severity,
          sourceKind: 'monitor',
          sourceId: taskId,
        });
      },
    );
    try {
      this.loop.enqueue(request);
    } catch {
      // The loop is gone (agent teardown): the process is being stopped by the
      // task service anyway, so a late line is simply dropped.
    }
  }

  private nextMonitorSeq(taskId: string): number {
    const next = (this.monitorSeqCounters.get(taskId) ?? 0) + 1;
    this.monitorSeqCounters.set(taskId, next);
    return next;
  }

  private spawn(effectiveCwd: string, command: string): Promise<IProcess> {
    const shellCwd = this.isWindowsBash ? windowsPathToPosixPath(effectiveCwd) : effectiveCwd;
    const shellArgs = [
      this.env.shellPath,
      '-c',
      `cd ${shellQuote(shellCwd)} && ${command}`,
    ];

    const noninteractiveEnv: Record<string, string> = {
      NO_COLOR: '1',
      TERM: 'dumb',
      GIT_TERMINAL_PROMPT: process.env['GIT_TERMINAL_PROMPT'] ?? '0',
      SHELL: this.env.shellPath,
    };

    return this.runner.exec(shellArgs, { env: noninteractiveEnv });
  }
}

registerAgentToolService(IMonitorTool, MonitorTool, { name: 'Monitor', domain: 'agentTask' });

function closeProcessStdin(proc: IProcess): void {
  try {
    proc.stdin.end();
  } catch {
    /* process already gone */
  }
}

async function killSpawnedProcess(proc: IProcess): Promise<void> {
  try {
    await proc.kill('SIGTERM');
  } catch {
    /* process already gone */
  } finally {
    try {
      await proc.dispose();
    } catch {
      /* best-effort cleanup */
    }
  }
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function windowsPathToPosixPath(path: string): string {
  if (path.startsWith('\\\\')) {
    return path.replaceAll('\\', '/');
  }

  const driveMatch = /^([A-Za-z]):(?:[\\/]|$)/.exec(path);
  if (driveMatch !== null) {
    const drive = driveMatch[1]!.toLowerCase();
    const rest = path.slice(2).replaceAll('\\', '/');
    return `/${drive}${rest.startsWith('/') ? rest : `/${rest}`}`;
  }

  return path.replaceAll('\\', '/');
}

const WINDOWS_NUL_REDIRECT = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g;

function rewriteWindowsNullRedirect(command: string): string {
  return command.replace(WINDOWS_NUL_REDIRECT, '$1/dev/null');
}

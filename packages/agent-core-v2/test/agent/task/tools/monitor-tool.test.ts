/**
 * Covers: MonitorTool — registration of detached monitor tasks and
 * monitor_line notification delivery.
 */

import { PassThrough, Readable } from 'node:stream';
import type { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IEventBus } from '#/app/event/eventBus';
import type { DomainEvent } from '#/app/event/eventBus';
import type {
  AgentTask,
  IAgentTaskService,
  RegisterAgentTaskOptions,
} from '#/agent/task/task';
import type { AgentTaskSink, AgentTaskSettlement } from '#/agent/task/types';
import type { TaskNotificationStepRequest } from '#/agent/task/taskService';
import type { IAgentLoopService } from '#/agent/loop/loop';
import type { StepRequest } from '#/agent/loop/stepRequest';
import type { IHostEnvironment } from '#/os/interface/hostEnvironment';
import { type ISessionContext, makeSessionContext } from '#/session/sessionContext/sessionContext';
import type { IProcess, ISessionProcessRunner } from '#/session/process/processRunner';
import { MonitorTask } from '#/agent/tools/task/monitor/monitor-task';
import { MonitorTool } from '#/agent/tools/task/monitor/monitorTool';
import { MonitorTool as V1MonitorTool } from '../../../../../agent-core/src/tools/background/monitor';
import { executeTool } from '../../../tools/fixtures/execute-tool';

const signal = new AbortController().signal;

const posixEnv: IHostEnvironment = {
  _serviceBrand: undefined,
  osKind: 'Linux',
  osArch: 'arm64',
  osVersion: 'test',
  shellPath: '/bin/bash',
  shellName: 'bash',
  pathClass: 'posix',
  homeDir: '/home/test',
  ready: Promise.resolve(),
};

const ctx: ISessionContext = makeSessionContext({
  sessionId: 'session-test',
  workspaceId: 'workspace-test',
  sessionDir: '/tmp/session-test',
  sessionScope: 'session-test',
  cwd: '/workspace',
});

function fakeProcess(): IProcess {
  return {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    pid: 12345,
    exitCode: null,
    wait: vi.fn().mockResolvedValue(0),
    kill: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

interface RegisteredTask {
  readonly task: AgentTask;
  readonly options: RegisterAgentTaskOptions | undefined;
}

/**
 * Fake `IAgentTaskService` that captures registrations and optionally drives
 * the real task's `start` (so stream observation matches production).
 */
class FakeTaskService {
  readonly registered: RegisteredTask[] = [];

  constructor(
    private readonly taskId: string,
    private readonly drive: boolean,
  ) {}

  readonly registerTask = vi.fn((task: AgentTask, options?: RegisterAgentTaskOptions): string => {
    this.registered.push({ task, options });
    if (this.drive) {
      void task.start(this.sink);
    }
    return this.taskId;
  });

  readonly sink: AgentTaskSink & { appendOutput: ReturnType<typeof vi.fn> } = {
    signal: new AbortController().signal,
    appendOutput: vi.fn<(chunk: string) => void>(),
    settle: vi.fn<(settlement: AgentTaskSettlement) => Promise<boolean>>().mockResolvedValue(true),
  };
}

function asTaskService(fake: FakeTaskService): IAgentTaskService {
  return { registerTask: fake.registerTask } as unknown as IAgentTaskService;
}

interface CapturedEnqueue {
  readonly requests: StepRequest[];
  readonly service: IAgentLoopService;
}

function fakeLoop(): CapturedEnqueue {
  const requests: StepRequest[] = [];
  const service = {
    enqueue: vi.fn((request: StepRequest) => {
      requests.push(request);
      return { assigned: new Promise(() => {}), abort: vi.fn() };
    }),
  } as unknown as IAgentLoopService;
  return { requests, service };
}

interface CapturedEvents {
  readonly events: DomainEvent[];
  readonly bus: IEventBus;
}

function fakeEventBus(): CapturedEvents {
  const events: DomainEvent[] = [];
  const bus = {
    publish: vi.fn((event: DomainEvent) => {
      events.push(event);
    }),
  } as unknown as IEventBus;
  return { events, bus };
}

interface ModelFacingToolContract {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

function expectModelFacingParity(
  actual: ModelFacingToolContract,
  expected: ModelFacingToolContract,
): void {
  expect(actual.name).toBe(expected.name);
  expect(actual.description).toBe(expected.description);
  expect(JSON.stringify(actual.parameters)).toBe(JSON.stringify(expected.parameters));
}

describe('MonitorTool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a detached monitor task and returns its task id', async () => {
    const proc = fakeProcess();
    const runner = { exec: vi.fn().mockResolvedValue(proc) } as unknown as ISessionProcessRunner;
    const tasks = new FakeTaskService('monitor-test123', false);
    const tool = new MonitorTool(runner, posixEnv, ctx, asTaskService(tasks), fakeLoop().service, fakeEventBus().bus);

    const result = await executeTool(tool, {
      turnId: 0,
      toolCallId: 'call-1',
      args: {
        command: 'tail -f log.txt | grep --line-buffered ERROR',
        description: 'watch errors',
        timeout_ms: 300000,
        persistent: false,
      },
      signal,
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('task_id: monitor-test123');
    expect(result.output).toContain('persistent: false');
    expect(tasks.registered).toHaveLength(1);
    const { task, options } = tasks.registered[0]!;
    expect(task).toBeInstanceOf(MonitorTask);
    expect((task as MonitorTask).proc).toBe(proc);
    expect((task as MonitorTask).command).toBe('tail -f log.txt | grep --line-buffered ERROR');
    expect((task as MonitorTask).description).toBe('watch errors');
    expect(options).toEqual({ detached: true, timeoutMs: 300000 });
  });

  it('passes undefined timeout for persistent monitors', async () => {
    const proc = fakeProcess();
    const runner = { exec: vi.fn().mockResolvedValue(proc) } as unknown as ISessionProcessRunner;
    const tasks = new FakeTaskService('monitor-persist', false);
    const tool = new MonitorTool(runner, posixEnv, ctx, asTaskService(tasks), fakeLoop().service, fakeEventBus().bus);

    const result = await executeTool(tool, {
      turnId: 0,
      toolCallId: 'call-1',
      args: {
        command: 'tail -F app.log',
        description: 'watch log',
        timeout_ms: 300000,
        persistent: true,
      },
      signal,
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain('persistent: true');
    expect(tasks.registered).toHaveLength(1);
    const { options } = tasks.registered[0]!;
    expect(options).toEqual({ detached: true, timeoutMs: undefined });
  });

  it('delivers emitted lines as monitor_line notifications through the loop', async () => {
    const stdout = new PassThrough();
    let resolveWait!: (exitCode: number) => void;
    const waitPromise = new Promise<number>((resolve) => {
      resolveWait = resolve;
    });
    const proc: IProcess = {
      stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
      stdout,
      stderr: Readable.from([]),
      pid: 12345,
      exitCode: null,
      wait: () => waitPromise,
      kill: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const runner = { exec: vi.fn().mockResolvedValue(proc) } as unknown as ISessionProcessRunner;
    const tasks = new FakeTaskService('monitor-test123', true);
    const loop = fakeLoop();
    const bus = fakeEventBus();
    const tool = new MonitorTool(runner, posixEnv, ctx, asTaskService(tasks), loop.service, bus.bus);

    await executeTool(tool, {
      turnId: 0,
      toolCallId: 'call-1',
      args: { command: 'tail -F app.log', description: 'watch log', timeout_ms: 300000, persistent: false },
      signal,
    });

    stdout.write('ERROR first\nERROR second\n');
    await vi.advanceTimersByTimeAsync(200);

    expect(loop.requests).toHaveLength(1);
    const request = loop.requests[0] as TaskNotificationStepRequest;
    const messages = request.resolveContextMessages();
    expect(messages).toHaveLength(1);
    const text = (messages[0]!.content[0] as { readonly type: 'text'; readonly text: string }).text;
    expect(text).toContain('<notification id="monitor:monitor-test123:1" category="task" type="monitor_line" source_kind="monitor" source_id="monitor-test123">');
    expect(text).toContain('Title: watch log');
    expect(text).toContain('ERROR first\nERROR second');
    expect(messages[0]!.origin).toEqual({
      kind: 'task',
      taskId: 'monitor-test123',
      status: 'running',
      notificationId: 'monitor:monitor-test123',
    });

    // The Notification hook fires when the message materializes in context.
    expect(bus.events).toHaveLength(0);
    request.onWillMaterialize();
    expect(bus.events).toEqual([
      {
        type: 'task.notified',
        notificationType: 'monitor_line',
        title: 'watch log',
        body: 'ERROR first\nERROR second',
        severity: 'info',
        sourceKind: 'monitor',
        sourceId: 'monitor-test123',
      },
    ]);

    stdout.end();
    resolveWait(0);
  });

  it('matches the v1 model-facing contract exactly', () => {
    const tasks = new FakeTaskService('monitor-test123', false);
    const tool = new MonitorTool(
      { exec: vi.fn() } as unknown as ISessionProcessRunner,
      posixEnv,
      ctx,
      asTaskService(tasks),
      fakeLoop().service,
      fakeEventBus().bus,
    );
    expectModelFacingParity(
      tool,
      new V1MonitorTool({ osEnv: { osKind: 'Linux' } } as never, '/workspace', {} as never),
    );
  });
});

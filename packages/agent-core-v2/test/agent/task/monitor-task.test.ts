/**
 * Covers: MonitorTask line buffering, batching, terminal flush, and volume
 * cap. Ported from v1 (`packages/agent-core/test/agent/background/monitor-task.test.ts`).
 */

import { PassThrough, Readable } from 'node:stream';
import type { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IProcess } from '#/session/process/processRunner';
import type { AgentTaskSink } from '#/agent/task/types';
import { MonitorTask, type MonitorEmit } from '#/agent/tools/task/monitor/monitor-task';

function createMonitorProcess(): {
  proc: IProcess;
  stdout: PassThrough;
  resolveWait: (exitCode: number) => void;
  killSpy: ReturnType<typeof vi.fn>;
  disposeSpy: ReturnType<typeof vi.fn>;
} {
  const stdout = new PassThrough();
  const stderr = Readable.from([]);
  let resolveWait!: (exitCode: number) => void;
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  const killSpy = vi.fn().mockResolvedValue(undefined);
  const disposeSpy = vi.fn().mockResolvedValue(undefined);
  const proc: IProcess = {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout,
    stderr,
    pid: 12345,
    exitCode: null,
    wait: () => waitPromise,
    kill: killSpy as unknown as IProcess['kill'],
    dispose: disposeSpy as unknown as IProcess['dispose'],
  };
  return { proc, stdout, resolveWait, killSpy, disposeSpy };
}

function createSink(controller?: AbortController): AgentTaskSink & { appendOutput: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> } {
  const ctrl = controller ?? new AbortController();
  return {
    signal: ctrl.signal,
    appendOutput: vi.fn<(chunk: string) => void>(),
    settle: vi.fn().mockResolvedValue(true),
  };
}

describe('MonitorTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches complete lines and flushes after batchMs', async () => {
    const { proc, stdout, resolveWait } = createMonitorProcess();
    const emits: { lines: string[]; sev?: string }[] = [];
    const emit: MonitorEmit = (lines, sev) => emits.push({ lines: [...lines], sev });
    const task = new MonitorTask(proc, 'echo a b', 'test', emit, { batchMs: 200 });
    const sink = createSink();

    const startPromise = task.start(sink);
    await Promise.resolve();
    stdout.write('a\nb\n');
    stdout.end();
    await vi.advanceTimersByTimeAsync(200);
    resolveWait(0);
    await startPromise;

    expect(emits).toHaveLength(1);
    expect(emits[0]).toEqual({ lines: ['a', 'b'] });
  });

  it('holds a partial line until a newline arrives', async () => {
    const { proc, stdout, resolveWait } = createMonitorProcess();
    const emits: { lines: string[]; sev?: string }[] = [];
    const emit: MonitorEmit = (lines, sev) => emits.push({ lines: [...lines], sev });
    const task = new MonitorTask(proc, 'echo partial', 'test', emit, { batchMs: 200 });
    const sink = createSink();

    const startPromise = task.start(sink);
    await Promise.resolve();
    stdout.write('part');
    await vi.advanceTimersByTimeAsync(200);
    expect(emits).toHaveLength(0);

    stdout.write('ial\n');
    await vi.advanceTimersByTimeAsync(200);
    stdout.end();
    resolveWait(0);
    await startPromise;

    expect(emits).toHaveLength(1);
    expect(emits[0]).toEqual({ lines: ['partial'] });
  });

  it('flushes a trailing partial line when the process ends', async () => {
    const { proc, stdout, resolveWait } = createMonitorProcess();
    const emits: { lines: string[]; sev?: string }[] = [];
    const emit: MonitorEmit = (lines, sev) => emits.push({ lines: [...lines], sev });
    const task = new MonitorTask(proc, 'echo trailing', 'test', emit, { batchMs: 200 });
    const sink = createSink();

    const startPromise = task.start(sink);
    await Promise.resolve();
    stdout.write('a\npartial');
    stdout.end();
    resolveWait(0);
    await startPromise;

    expect(emits.map((e) => e.lines)).toEqual([['a'], ['partial']]);
  });

  it('flushes a single unterminated line when the process ends', async () => {
    const { proc, stdout, resolveWait } = createMonitorProcess();
    const emits: { lines: string[]; sev?: string }[] = [];
    const emit: MonitorEmit = (lines, sev) => emits.push({ lines: [...lines], sev });
    const task = new MonitorTask(proc, 'echo only', 'test', emit, { batchMs: 200 });
    const sink = createSink();

    const startPromise = task.start(sink);
    await Promise.resolve();
    stdout.write('only');
    stdout.end();
    resolveWait(0);
    await startPromise;

    expect(emits.map((e) => e.lines)).toEqual([['only']]);
  });

  it('auto-stops and emits a warning when line volume exceeds the cap', async () => {
    const { proc, stdout, resolveWait, killSpy } = createMonitorProcess();
    const emits: { lines: string[]; sev?: string }[] = [];
    const emit: MonitorEmit = (lines, sev) => emits.push({ lines: [...lines], sev });
    const task = new MonitorTask(
      proc,
      'flood',
      'test',
      emit,
      { batchMs: 200, maxLinesPerWindow: 200, volumeWindowMs: 5000 },
    );
    const sink = createSink();

    const startPromise = task.start(sink);
    await Promise.resolve();
    const data = Array.from({ length: 201 }, (_, i) => `line-${String(i)}`).join('\n') + '\n';
    stdout.write(data);
    stdout.end();
    resolveWait(0);
    await startPromise;

    expect(killSpy).toHaveBeenCalledWith('SIGKILL');
    expect(emits.some((e) => e.sev === 'warning' && e.lines[0]?.includes('too noisy'))).toBe(true);
  });

  it('tees every stdout chunk to the sink', async () => {
    const { proc, stdout, resolveWait } = createMonitorProcess();
    const task = new MonitorTask(proc, 'echo tee', 'test', () => {}, { batchMs: 200 });
    const sink = createSink();

    const startPromise = task.start(sink);
    await Promise.resolve();
    stdout.write('a\n');
    stdout.write('b\n');
    stdout.end();
    await vi.advanceTimersByTimeAsync(200);
    resolveWait(0);
    await startPromise;

    expect(sink.appendOutput).toHaveBeenCalledWith('a\n');
    expect(sink.appendOutput).toHaveBeenCalledWith('b\n');
  });

  it('reports monitor info via toInfo', () => {
    const { proc } = createMonitorProcess();
    const task = new MonitorTask(proc, 'echo info', 'desc', () => {});
    const info = task.toInfo({
      taskId: 'monitor-abc12345',
      description: 'desc',
      status: 'running',
      detached: true,
      startedAt: 1,
      endedAt: null,
    });

    expect(info).toEqual({
      taskId: 'monitor-abc12345',
      description: 'desc',
      status: 'running',
      detached: true,
      startedAt: 1,
      endedAt: null,
      kind: 'monitor',
      command: 'echo info',
    });
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { GesExecutor } from '../executor.ts';
import { expandRun, expandTemplate } from '../bindings.ts';
import type { ExecutorHandlers, GesEvent } from '../types.ts';

const EXAMPLES = resolve(import.meta.dirname!, '../../examples');

function mockHandlers(overrides?: Partial<ExecutorHandlers>): ExecutorHandlers & { events: GesEvent[] } {
  const events: GesEvent[] = [];
  return {
    events,
    async onPrompt() { return ''; },
    async onRun() { return { exitCode: 0, stdout: '', stderr: '' }; },
    async onVerifySelf() { return true; },
    async onEdgeEval() { return true; },
    onEvent(event) { events.push(event); },
    ...overrides,
  };
}

function tmpDir(): string {
  return mkdtempSync(resolve(tmpdir(), 'ges-test-'));
}

describe('executor', () => {
  it('runs simple graph to completion', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const executor = new GesExecutor({
      gesFile: resolve(EXAMPLES, 'simple/hello.ges.yaml'),
      stateDir: dir,
      handlers,
    });

    const state = await executor.run();
    assert.strictEqual(state.active['end'], null);
    assert.ok(handlers.events.some(e => e.type === 'done'));

    rmSync(dir, { recursive: true });
  });

  it('step mode advances one action at a time', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const executor = new GesExecutor({
      gesFile: resolve(EXAMPLES, 'simple/hello.ges.yaml'),
      stateDir: dir,
      handlers,
    });

    let result = await executor.step();
    assert.strictEqual(result.done, false);

    while (!result.done) {
      result = await executor.step();
    }
    assert.ok('end' in executor.getState().active);

    rmSync(dir, { recursive: true });
  });

  it('captures output variables', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers({
      async onPrompt() { return '["AC1: tests pass"]'; },
    });

    const executor = new GesExecutor({
      gesFile: resolve(EXAMPLES, 'odyssey-planex/odyssey-planex.ges.yaml'),
      stateDir: dir,
      handlers,
    });

    await executor.step(); // parse
    await executor.step(); // define_criteria
    const state = executor.getState();
    assert.ok('acceptance_criteria' in state.variables);

    rmSync(dir, { recursive: true });
  });

  it('expands bindings in run commands', async () => {
    const dir = tmpDir();
    let capturedCmd = '';
    const handlers = mockHandlers({
      async onRun(cmd) {
        capturedCmd = cmd;
        return { exitCode: 0, stdout: '{}', stderr: '' };
      },
    });

    const executor = new GesExecutor({
      gesFile: resolve(EXAMPLES, 'review-loop/review-loop.ges.yaml'),
      stateDir: dir,
      handlers,
    });

    await executor.step(); // implement.code (prompt)
    await executor.step(); // edge eval → review
    await executor.step(); // review.check (run+prompt)

    assert.ok(capturedCmd.includes('maestro delegate --role review'), `Expected binding expansion, got: ${capturedCmd}`);

    rmSync(dir, { recursive: true });
  });

  it('resumes from saved state', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const exec1 = new GesExecutor({
      gesFile: resolve(EXAMPLES, 'simple/hello.ges.yaml'),
      stateDir: dir,
      handlers,
    });
    await exec1.step();

    const exec2 = new GesExecutor({
      gesFile: resolve(EXAMPLES, 'simple/hello.ges.yaml'),
      stateDir: dir,
      handlers,
      resume: true,
    });
    const state = exec2.getState();
    assert.strictEqual(state.source, 'hello');

    rmSync(dir, { recursive: true });
  });
});

describe('bindings', () => {
  it('expandRun resolves binding alias', () => {
    const result = expandRun('analyzer --verbose', { analyzer: 'maestro delegate --role analyze' });
    assert.strictEqual(result, 'maestro delegate --role analyze --verbose');
  });

  it('expandTemplate replaces variables', () => {
    const result = expandTemplate('hello {{name}}, count={{count}}', { name: 'world', count: 42 });
    assert.strictEqual(result, 'hello world, count=42');
  });

  it('expandTemplate handles nested paths', () => {
    const result = expandTemplate('{{user.name}}', { user: { name: 'Alice' } });
    assert.strictEqual(result, 'Alice');
  });
});

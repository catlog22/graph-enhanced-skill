import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { GesExecutor } from '../executor.ts';
import type { ExecutorHandlers, GesEvent, GesGraph } from '../types.ts';

function mockHandlers(overrides?: Partial<ExecutorHandlers>): ExecutorHandlers & { events: GesEvent[] } {
  const events: GesEvent[] = [];
  return {
    events,
    async onPrompt() { return ''; },
    async onRun() { return { exitCode: 0, stdout: '', stderr: '' }; },
    async onVerifySelf() { return true; },
    async onEdgeEval(expr) {
      if (expr === 'true' || expr === 'goal') return true;
      if (expr === 'false' || expr === '!goal') return false;
      return true;
    },
    onEvent(event) { events.push(event); },
    ...overrides,
  };
}

function tmpDir(): string {
  return mkdtempSync(resolve(tmpdir(), 'ges-par-'));
}

function writeGraph(dir: string, graph: GesGraph): string {
  const filePath = resolve(dir, 'test.ges.yaml');
  writeFileSync(filePath, stringifyYaml(graph), 'utf-8');
  return filePath;
}

describe('parallel: fork/join', () => {
  it('fork activates multiple nodes from to:[]', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'fork-test', entry: 'start', terminal: ['end'] },
      nodes: {
        start: { actions: [{ id: 'init', prompt: 'begin' }] },
        a: { actions: [{ id: 'do_a', prompt: 'task a' }] },
        b: { actions: [{ id: 'do_b', prompt: 'task b' }] },
        merge: { actions: [{ id: 'combine', prompt: 'merge results' }] },
      },
      edges: [
        { from: 'start', to: ['a', 'b'] },
        { from: ['a', 'b'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    };

    const gesFile = writeGraph(dir, graph);
    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = await executor.run();

    assert.ok('end' in state.active);
    assert.ok(handlers.events.some(e => e.type === 'fork'));
    assert.ok(handlers.events.some(e => e.type === 'join'));
    assert.ok(handlers.events.some(e => e.type === 'done'));

    const forkEv = handlers.events.find(e => e.type === 'fork')!;
    assert.deepStrictEqual((forkEv as any).targets.sort(), ['a', 'b']);

    const joinEv = handlers.events.find(e => e.type === 'join')!;
    assert.deepStrictEqual((joinEv as any).sources.sort(), ['a', 'b']);
    assert.strictEqual((joinEv as any).to, 'merge');

    rmSync(dir, { recursive: true });
  });

  it('fork with 3 branches and join', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'triple-fork', entry: 'start', terminal: ['end'] },
      nodes: {
        start: { actions: [{ id: 'init', prompt: 'begin' }] },
        a: { actions: [{ id: 'do', prompt: 'a' }] },
        b: { actions: [{ id: 'do', prompt: 'b' }] },
        c: { actions: [{ id: 'do', prompt: 'c' }] },
        merge: { actions: [{ id: 'combine', prompt: 'done' }] },
      },
      edges: [
        { from: 'start', to: ['a', 'b', 'c'] },
        { from: ['a', 'b', 'c'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    };

    const gesFile = writeGraph(dir, graph);
    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = await executor.run();

    assert.ok('end' in state.active);

    const nodeEnters = handlers.events
      .filter(e => e.type === 'node_enter')
      .map(e => (e as any).node);
    assert.ok(nodeEnters.includes('a'));
    assert.ok(nodeEnters.includes('b'));
    assert.ok(nodeEnters.includes('c'));
    assert.ok(nodeEnters.includes('merge'));

    rmSync(dir, { recursive: true });
  });

  it('parallel nodes share variables', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers({
      async onPrompt(instruction) {
        if (instruction.includes('task a')) return '"result_a"';
        if (instruction.includes('task b')) return '"result_b"';
        return '';
      },
    });

    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'shared-vars', entry: 'start', terminal: ['end'] },
      nodes: {
        start: { actions: [{ id: 'init', prompt: 'begin' }] },
        a: { actions: [{ id: 'do', prompt: 'task a', output: ['out_a'] }] },
        b: { actions: [{ id: 'do', prompt: 'task b', output: ['out_b'] }] },
        merge: { actions: [{ id: 'combine', prompt: 'merge {{out_a}} {{out_b}}' }] },
      },
      edges: [
        { from: 'start', to: ['a', 'b'] },
        { from: ['a', 'b'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    };

    const gesFile = writeGraph(dir, graph);
    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = await executor.run();

    assert.strictEqual(state.variables['out_a'], 'result_a');
    assert.strictEqual(state.variables['out_b'], 'result_b');

    rmSync(dir, { recursive: true });
  });
});

describe('parallel: goal', () => {
  it('meta.goal injects goal variable into edge when context', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers({
      async onEdgeEval(expr) {
        if (expr.includes('all_pass')) return true;
        if (expr === 'goal') return true;
        return false;
      },
    });

    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'goal-test', entry: 'work', terminal: ['end'], goal: 'all_pass' },
      nodes: {
        work: { actions: [{ id: 'do', prompt: 'work' }] },
      },
      edges: [
        { from: 'work', to: 'end', when: 'goal' },
      ],
    };

    const gesFile = writeGraph(dir, graph);
    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = await executor.run();

    assert.ok('end' in state.active);
    assert.ok(handlers.events.some(e => e.type === 'goal_eval'));

    rmSync(dir, { recursive: true });
  });

  it('goal=false routes to non-goal edge', async () => {
    const dir = tmpDir();
    let iteration = 0;
    const handlers = mockHandlers({
      async onEdgeEval(expr) {
        if (expr.includes('all_pass')) return iteration >= 1;
        if (expr === 'goal') return iteration >= 1;
        if (expr === '!goal') return iteration < 1;
        return true;
      },
    });

    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'goal-loop', entry: 'work', terminal: ['end'], goal: 'all_pass' },
      nodes: {
        work: { actions: [{ id: 'do', prompt: 'work' }] },
        fix: { actions: [{ id: 'patch', prompt: 'fix' }] },
      },
      edges: [
        { from: 'work', to: 'end', when: 'goal' },
        { from: 'work', to: 'fix', when: '!goal' },
        { from: 'fix', to: 'work' },
      ],
    };

    const gesFile = writeGraph(dir, graph);
    const executor = new GesExecutor({
      gesFile, stateDir: dir,
      handlers: {
        ...handlers,
        async onPrompt() { iteration++; return ''; },
      },
    });
    const state = await executor.run();

    assert.ok('end' in state.active);
    assert.ok(iteration >= 1);

    rmSync(dir, { recursive: true });
  });
});

describe('parallel: step mode', () => {
  it('step through fork/join', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'step-fork', entry: 'start', terminal: ['end'] },
      nodes: {
        start: { actions: [{ id: 'init', prompt: 'begin' }] },
        a: { actions: [{ id: 'do', prompt: 'a' }] },
        b: { actions: [{ id: 'do', prompt: 'b' }] },
        merge: { actions: [{ id: 'combine', prompt: 'merge' }] },
      },
      edges: [
        { from: 'start', to: ['a', 'b'] },
        { from: ['a', 'b'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    };

    const gesFile = writeGraph(dir, graph);
    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });

    const eventTypes: string[] = [];
    let done = false;
    while (!done) {
      const result = await executor.step();
      eventTypes.push(result.event.type);
      done = result.done;
    }

    assert.ok(eventTypes.includes('fork'));
    assert.ok(eventTypes.includes('join'));

    rmSync(dir, { recursive: true });
  });
});

describe('loader: ges/1.1 validation', () => {
  it('accepts ges/1.1 with array from/to', async () => {
    const dir = tmpDir();
    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'valid-fork', entry: 'start', terminal: ['end'] },
      nodes: {
        start: { actions: [{ id: 'do', prompt: 'go' }] },
        a: { actions: [{ id: 'do', prompt: 'a' }] },
        b: { actions: [{ id: 'do', prompt: 'b' }] },
      },
      edges: [
        { from: 'start', to: ['a', 'b'] },
        { from: ['a', 'b'], to: 'end' },
      ],
    };

    const gesFile = writeGraph(dir, graph);
    const { loadGraph } = await import('../loader.ts');
    const loaded = loadGraph(gesFile);
    assert.strictEqual(loaded.schema, 'ges/1.1');
    assert.deepStrictEqual(loaded.edges[0].to, ['a', 'b']);

    rmSync(dir, { recursive: true });
  });

  it('rejects edge with both from[] and to[]', async () => {
    const dir = tmpDir();
    const graph = {
      schema: 'ges/1.1',
      meta: { name: 'bad-edge', entry: 'start', terminal: ['end'] },
      nodes: {
        start: { actions: [{ id: 'do', prompt: 'go' }] },
        a: { actions: [{ id: 'do', prompt: 'a' }] },
        b: { actions: [{ id: 'do', prompt: 'b' }] },
      },
      edges: [
        { from: ['a', 'b'], to: ['start', 'end'] },
      ],
    };

    const filePath = resolve(dir, 'bad.ges.yaml');
    writeFileSync(filePath, stringifyYaml(graph), 'utf-8');
    const { loadGraph } = await import('../loader.ts');

    assert.throws(() => loadGraph(filePath), /cannot have both/);

    rmSync(dir, { recursive: true });
  });

  it('rejects ges/1.0 schema', async () => {
    const dir = tmpDir();
    const graph = {
      schema: 'ges/1.0',
      meta: { name: 'old', entry: 'start', terminal: ['end'] },
      nodes: { start: { actions: [{ id: 'do', prompt: 'go' }] } },
      edges: [{ from: 'start', to: 'end' }],
    };

    const filePath = resolve(dir, 'old.ges.yaml');
    writeFileSync(filePath, stringifyYaml(graph), 'utf-8');
    const { loadGraph } = await import('../loader.ts');

    assert.throws(() => loadGraph(filePath), /expected "ges\/1.1"/);

    rmSync(dir, { recursive: true });
  });
});

describe('state: active-only', () => {
  it('state uses active instead of current_node', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const graph: GesGraph = {
      schema: 'ges/1.1',
      meta: { name: 'active-test', entry: 'start', terminal: ['end'] },
      nodes: {
        start: { actions: [{ id: 'do', prompt: 'go' }] },
      },
      edges: [{ from: 'start', to: 'end' }],
    };

    const gesFile = writeGraph(dir, graph);
    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = executor.getState();

    assert.ok('active' in state);
    assert.ok(!('current_node' in state));
    assert.ok(!('current_action' in state));
    assert.deepStrictEqual(state.active, { start: null });

    rmSync(dir, { recursive: true });
  });
});

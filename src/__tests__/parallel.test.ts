import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { GesExecutor } from '../executor.ts';
import { parseGesMarkdown } from '../md-loader.ts';
import { validateGraph } from '../loader.ts';
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

interface MdGraphOpts {
  name: string;
  entry: string;
  terminal: string[];
  goal?: string;
  nodes: Record<string, { actions: { id: string; prompt?: string; run?: string; output?: string[] }[] }>;
  edges: { from: string | string[]; to: string | string[]; when?: string }[];
}

function writeMdGraph(dir: string, opts: MdGraphOpts): string {
  const filePath = resolve(dir, 'test.ges.md');
  const lines: string[] = [];

  lines.push('---');
  lines.push('schema: ges/2.0');
  lines.push(`name: ${opts.name}`);
  if (opts.goal) lines.push(`goal: "${opts.goal}"`);
  lines.push('---');
  lines.push('');
  lines.push('<graph>');

  for (const [nodeId, node] of Object.entries(opts.nodes)) {
    const isEntry = nodeId === opts.entry;
    const isTerminal = opts.terminal.includes(nodeId);
    const attrs: string[] = [`id="${nodeId}"`];
    if (isEntry) attrs.push('entry');
    if (isTerminal) attrs.push('terminal');

    if (node.actions.length === 0 && isTerminal) {
      lines.push(`<node ${attrs.join(' ')} />`);
      continue;
    }

    if (node.actions.length === 1) {
      const a = node.actions[0];
      if (a.run) attrs.push(`run="${a.run}"`);
      if (a.output) attrs.push(`output="${a.output.join(',')}"`);
      lines.push(`<node ${attrs.join(' ')} />`);
      continue;
    }

    lines.push(`<node ${attrs.join(' ')}>`);
    for (const a of node.actions) {
      const aa: string[] = [`id="${a.id}"`];
      if (a.run) aa.push(`run="${a.run}"`);
      if (a.output) aa.push(`output="${a.output.join(',')}"`);
      lines.push(`  <action ${aa.join(' ')} />`);
    }
    lines.push('</node>');
  }

  for (const nodeId of opts.terminal) {
    if (!(nodeId in opts.nodes)) {
      lines.push(`<node id="${nodeId}" terminal />`);
    }
  }

  for (const edge of opts.edges) {
    const from = Array.isArray(edge.from) ? edge.from.join(', ') : edge.from;
    const to = Array.isArray(edge.to) ? edge.to.join(', ') : edge.to;
    const isJoin = Array.isArray(edge.from) && edge.from.length > 1;

    if (isJoin) {
      lines.push(`<join from="${from}" to="${to}" />`);
    } else {
      const whenAttr = edge.when ? ` when="${edge.when}"` : '';
      lines.push(`<edge from="${from}" to="${to}"${whenAttr} />`);
    }
  }

  lines.push('</graph>');

  for (const [nodeId, node] of Object.entries(opts.nodes)) {
    for (const a of node.actions) {
      if (a.prompt) {
        const ref = node.actions.length > 1 ? `${nodeId}.${a.id}` : nodeId;
        lines.push('');
        lines.push(`## [${ref}]`);
        lines.push('');
        lines.push(a.prompt);
      }
    }
  }

  writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}

describe('parallel: fork/join', () => {
  it('fork activates multiple nodes from to:[]', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const gesFile = writeMdGraph(dir, {
      name: 'fork-test', entry: 'start', terminal: ['end'],
      nodes: {
        start: { actions: [{ id: 'start', prompt: 'begin' }] },
        a: { actions: [{ id: 'a', prompt: 'task a' }] },
        b: { actions: [{ id: 'b', prompt: 'task b' }] },
        merge: { actions: [{ id: 'merge', prompt: 'merge results' }] },
        end: { actions: [] },
      },
      edges: [
        { from: 'start', to: ['a', 'b'] },
        { from: ['a', 'b'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    });

    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = await executor.run();

    assert.ok('end' in state.active);
    assert.ok(handlers.events.some(e => e.type === 'fork'));
    assert.ok(handlers.events.some(e => e.type === 'join'));
    assert.ok(handlers.events.some(e => e.type === 'done'));

    const forkEv = handlers.events.find(e => e.type === 'fork')!;
    assert.deepStrictEqual((forkEv as any).targets.sort(), ['a', 'b']);

    rmSync(dir, { recursive: true });
  });

  it('fork with 3 branches and join', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const gesFile = writeMdGraph(dir, {
      name: 'triple-fork', entry: 'start', terminal: ['end'],
      nodes: {
        start: { actions: [{ id: 'start', prompt: 'begin' }] },
        a: { actions: [{ id: 'a', prompt: 'a' }] },
        b: { actions: [{ id: 'b', prompt: 'b' }] },
        c: { actions: [{ id: 'c', prompt: 'c' }] },
        merge: { actions: [{ id: 'merge', prompt: 'done' }] },
        end: { actions: [] },
      },
      edges: [
        { from: 'start', to: ['a', 'b', 'c'] },
        { from: ['a', 'b', 'c'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    });

    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = await executor.run();

    assert.ok('end' in state.active);
    const nodeEnters = handlers.events
      .filter(e => e.type === 'node_enter')
      .map(e => (e as any).node);
    assert.ok(nodeEnters.includes('a'));
    assert.ok(nodeEnters.includes('b'));
    assert.ok(nodeEnters.includes('c'));

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

    const gesFile = writeMdGraph(dir, {
      name: 'shared-vars', entry: 'start', terminal: ['end'],
      nodes: {
        start: { actions: [{ id: 'start', prompt: 'begin' }] },
        a: { actions: [{ id: 'a', prompt: 'task a', output: ['out_a'] }] },
        b: { actions: [{ id: 'b', prompt: 'task b', output: ['out_b'] }] },
        merge: { actions: [{ id: 'merge', prompt: 'merge' }] },
        end: { actions: [] },
      },
      edges: [
        { from: 'start', to: ['a', 'b'] },
        { from: ['a', 'b'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    });

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

    const gesFile = writeMdGraph(dir, {
      name: 'goal-test', entry: 'work', terminal: ['end'], goal: 'all_pass',
      nodes: {
        work: { actions: [{ id: 'work', prompt: 'work' }] },
        end: { actions: [] },
      },
      edges: [
        { from: 'work', to: 'end', when: 'goal' },
      ],
    });

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

    const gesFile = writeMdGraph(dir, {
      name: 'goal-loop', entry: 'work', terminal: ['end'], goal: 'all_pass',
      nodes: {
        work: { actions: [{ id: 'work', prompt: 'work' }] },
        fix: { actions: [{ id: 'fix', prompt: 'fix' }] },
        end: { actions: [] },
      },
      edges: [
        { from: 'work', to: 'end', when: 'goal' },
        { from: 'work', to: 'fix', when: '!goal' },
        { from: 'fix', to: 'work' },
      ],
    });

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

    const gesFile = writeMdGraph(dir, {
      name: 'step-fork', entry: 'start', terminal: ['end'],
      nodes: {
        start: { actions: [{ id: 'start', prompt: 'begin' }] },
        a: { actions: [{ id: 'a', prompt: 'a' }] },
        b: { actions: [{ id: 'b', prompt: 'b' }] },
        merge: { actions: [{ id: 'merge', prompt: 'merge' }] },
        end: { actions: [] },
      },
      edges: [
        { from: 'start', to: ['a', 'b'] },
        { from: ['a', 'b'], to: 'merge' },
        { from: 'merge', to: 'end' },
      ],
    });

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

describe('md-loader: validation', () => {
  it('accepts ges/2.0 with fork/join', () => {
    const src = `---
schema: ges/2.0
name: valid-fork
---

<graph>
<node id="start" entry />
<node id="a" />
<node id="b" />
<node id="end" terminal />
<edge from="start" to="a, b" />
<join from="a, b" to="end" />
</graph>

## [start]

go

## [a]

a

## [b]

b
`;
    const graph = parseGesMarkdown(src);
    validateGraph(graph, '<test>');
    assert.strictEqual(graph.schema, 'ges/2.0');
    assert.deepStrictEqual(graph.edges[0].to, ['a', 'b']);
  });

  it('rejects edge with both from[] and to[]', () => {
    const src = `---
schema: ges/2.0
name: bad-edge
---

<graph>
<node id="a" entry />
<node id="b" />
<node id="end" terminal />
<join from="a, b" to="end" />
<edge from="a" to="b" />
</graph>

## [a]

go

## [b]

go
`;
    const graph = parseGesMarkdown(src);
    graph.edges.push({ from: ['a', 'b'], to: ['end', 'a'] });
    assert.throws(() => validateGraph(graph, '<test>'), /cannot have both/);
  });

  it('rejects ges/1.0 schema', () => {
    const src = `---
schema: ges/1.0
name: old
---

<graph>
<node id="start" entry />
<node id="end" terminal />
<edge from="start" to="end" />
</graph>
`;
    assert.throws(() => parseGesMarkdown(src), /requires schema "ges\/2.0"/);
  });
});

describe('state: active-only', () => {
  it('state uses active instead of current_node', async () => {
    const dir = tmpDir();
    const handlers = mockHandlers();

    const gesFile = writeMdGraph(dir, {
      name: 'active-test', entry: 'start', terminal: ['end'],
      nodes: {
        start: { actions: [{ id: 'start', prompt: 'go' }] },
        end: { actions: [] },
      },
      edges: [{ from: 'start', to: 'end' }],
    });

    const executor = new GesExecutor({ gesFile, stateDir: dir, handlers });
    const state = executor.getState();

    assert.ok('active' in state);
    assert.ok(!('current_node' in state));
    assert.deepStrictEqual(state.active, { start: null });

    rmSync(dir, { recursive: true });
  });
});

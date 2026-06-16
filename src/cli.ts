#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { GesExecutor } from './executor.js';
import { loadGraph } from './loader.js';
import { loadState } from './state.js';
import { createSession, listSessions, resolveSession } from './sessions.js';
import { saveState } from './state.js';
import type { GesEvent, GesState, ExecutorHandlers, PromptContext, RunResult } from './types.js';

const [,, command, ...args] = process.argv;

const USAGE = `
ges — Graph-Enhanced Skill Executor

Session commands:
  ges load <file.ges.md>       Load graph, create session (auto ID)
  ges list                       List all sessions
  ges next <id>                  Advance one step (by session ID or prefix)
  ges complete <id>              Complete current node, transition to next
  ges run <id>                   Run to completion
  ges handoff <id> [--skip]      Accept or skip pending handoff

Inspection:
  ges status <id>                Show session state
  ges validate <file.ges.md>   Validate GES file
  ges viz <file.ges.md>        Print mermaid diagram
`.trim();

async function main() {
  switch (command) {
    case 'load':     return cmdLoad(args);
    case 'list':
    case 'ls':       return cmdList();
    case 'next':     return await cmdNext(args);
    case 'complete': return await cmdComplete(args);
    case 'run':      return await cmdRun(args);
    case 'handoff':  return cmdHandoff(args);
    case 'status':   return cmdStatus(args);
    case 'validate': return cmdValidate(args);
    case 'viz':      return cmdViz(args);
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

// ── load ──

function cmdLoad(args: string[]) {
  const gesFile = args[0];
  if (!gesFile) { console.error('Usage: ges load <file.ges.md>'); process.exit(1); }

  const graph = loadGraph(gesFile);
  const { id, stateDir } = createSession(gesFile, graph.meta.name);

  console.log(`Session created: ${id}`);
  console.log(`  graph: ${graph.meta.name} (${Object.keys(graph.nodes).length} nodes, ${graph.edges.length} edges)`);
  console.log(`  dir:   ${stateDir}`);
  console.log(`\nNext: ges next ${id.slice(0, 12)}`);
}

// ── list ──

function cmdList() {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log('No sessions. Use: ges load <file.ges.md>');
    return;
  }

  const col = { id: 28, active: 30, iter: 5 };
  console.log(
    pad('ID', col.id) + pad('ACTIVE', col.active) + pad('ITER', col.iter) + 'SOURCE',
  );
  console.log('-'.repeat(col.id + col.active + col.iter + 20));

  for (const s of sessions) {
    const activeStr = formatActive(s.active);
    console.log(
      pad(s.id, col.id) +
      pad(activeStr, col.active) +
      pad(String(s.iteration), col.iter) +
      s.source,
    );
  }
}

// ── next ──

async function cmdNext(args: string[]) {
  const session = requireSession(args[0], 'next');
  const handlers = createCliHandlers();

  const executor = new GesExecutor({
    gesFile: session.gesFile,
    stateDir: session.stateDir,
    handlers,
    resume: true,
  });

  const { done, event } = await executor.step();
  const state = executor.getState();

  console.log('');
  if (done) {
    console.log(`Done. Session ${session.id} reached terminal.`);
    printHandoffHint(state, session.id);
  } else {
    console.log(`Active: ${formatActive(state.active)} (iter=${state.iteration})`);
    console.log(`Next:  ges next ${session.id.slice(0, 12)}`);
  }
}

// ── complete ──

async function cmdComplete(args: string[]) {
  const session = requireSession(args[0], 'complete');
  const handlers = createCliHandlers();

  const executor = new GesExecutor({
    gesFile: session.gesFile,
    stateDir: session.stateDir,
    handlers,
    resume: true,
  });

  let result = await executor.step();
  const startActive = { ...executor.getState().active };

  while (!result.done) {
    const current = executor.getState().active;
    const changed = Object.keys(current).some(k => !(k in startActive)) ||
                    Object.keys(startActive).some(k => !(k in current));
    if (changed) break;
    result = await executor.step();
  }

  const newState = executor.getState();
  console.log('');
  if (result.done) {
    console.log(`Done. Reached terminal.`);
  } else {
    console.log(`Active: ${formatActive(newState.active)}`);
    console.log(`Next: ges next ${session.id.slice(0, 12)}`);
  }
}

// ── run ──

async function cmdRun(args: string[]) {
  const idOrFile = args[0];
  if (!idOrFile) { console.error('Usage: ges run <session-id | file.ges.md>'); process.exit(1); }

  let gesFile: string;
  let stateDir: string;
  let resume = false;

  if (idOrFile.endsWith('.ges.md')) {
    const graph = loadGraph(idOrFile);
    const sess = createSession(idOrFile, graph.meta.name);
    gesFile = resolve(idOrFile);
    stateDir = sess.stateDir;
    console.log(`Session: ${sess.id}`);
  } else {
    const session = requireSession(idOrFile, 'run');
    gesFile = session.gesFile;
    stateDir = session.stateDir;
    resume = true;
  }

  const handlers = createCliHandlers();
  const executor = new GesExecutor({ gesFile, stateDir, handlers, resume });

  console.log(`Run: ${executor.getGraph().meta.name}`);
  console.log(`  ${Object.keys(executor.getGraph().nodes).length} nodes, ${executor.getGraph().edges.length} edges\n`);

  const finalState = await executor.run();
  console.log(`\nDone. Active: ${formatActive(finalState.active)}`);

  const sessId = stateDir.split(/[\\/]/).pop() ?? '';
  printHandoffHint(finalState, sessId);
}

// ── status ──

function cmdStatus(args: string[]) {
  const session = requireSession(args[0], 'status');
  const statePath = resolve(session.stateDir, 'graph-state.yaml');

  if (!existsSync(statePath)) {
    console.log(`Session ${session.id}: not started yet.`);
    console.log(`GES file: ${session.gesFile}`);
    console.log(`Next: ges next ${session.id.slice(0, 12)}`);
    return;
  }

  const state = loadState(statePath);
  if (!state) { console.log('Empty state.'); return; }

  const graph = loadGraph(session.gesFile);
  const terminalSet = new Set(graph.meta.terminal);
  const isDone = Object.keys(state.active).every(
    k => state.active[k] === '__done__' || terminalSet.has(k),
  );

  console.log(`Session:  ${session.id}`);
  console.log(`Source:   ${state.source}`);
  console.log(`Status:   ${isDone ? 'DONE' : 'RUNNING'}`);
  console.log(`Active:   ${formatActive(state.active)}`);
  console.log(`Iter:     ${state.iteration}`);
  console.log(`Vars:     ${Object.keys(state.variables).join(', ') || '(empty)'}`);
  console.log(`Stack:    ${state.call_stack.length} frames`);

  const nodeNames = Object.keys(graph.nodes);
  console.log(`\nGraph: ${nodeNames.join(' → ')}`);

  if (!isDone) {
    console.log(`\nNext: ges next ${session.id.slice(0, 12)}`);
  }
}

// ── validate ──

function cmdValidate(args: string[]) {
  const gesFile = args[0];
  if (!gesFile) { console.error('Usage: ges validate <file.ges.md>'); process.exit(1); }

  try {
    const graph = loadGraph(gesFile);
    const actionCount = Object.values(graph.nodes).reduce((n, node) => n + node.actions.length, 0);
    console.log(`Valid: ${graph.meta.name}`);
    console.log(`  ${Object.keys(graph.nodes).length} nodes, ${graph.edges.length} edges, ${actionCount} actions, ${Object.keys(graph.bindings ?? {}).length} bindings`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

// ── viz ──

function cmdViz(args: string[]) {
  const gesFile = args[0];
  if (!gesFile) { console.error('Usage: ges viz <file.ges.md>'); process.exit(1); }

  const graph = loadGraph(gesFile);
  const lines: string[] = ['graph TD'];

  for (const [id, node] of Object.entries(graph.nodes)) {
    lines.push(`  ${id}["${id} (${node.actions.length})"]`);
  }
  for (const t of graph.meta.terminal) {
    lines.push(`  ${t}(("${t}"))`);
  }
  for (const edge of graph.edges) {
    const froms = Array.isArray(edge.from) ? edge.from : [edge.from];
    const tos = Array.isArray(edge.to) ? edge.to : [edge.to];
    const label = edge.when ? `|${edge.when}|` : '';
    for (const f of froms) {
      for (const t of tos) {
        lines.push(`  ${f} -->${label} ${t}`);
      }
    }
  }

  console.log('```mermaid');
  console.log(lines.join('\n'));
  console.log('```');
}

// ── CLI Handlers ──

function createCliHandlers(): ExecutorHandlers {
  return {
    async onPrompt(instruction: string): Promise<string> {
      console.log(`  [prompt] ${truncate(instruction, 100)}`);
      return '';
    },
    async onRun(command: string, input?: string): Promise<RunResult> {
      console.log(`  [run]    ${truncate(command, 100)}`);
      try {
        const stdout = execSync(command, { encoding: 'utf-8', timeout: 60_000, input, stdio: ['pipe', 'pipe', 'pipe'] });
        return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
      } catch (err: any) {
        return { exitCode: err.status ?? 1, stdout: err.stdout?.toString() ?? '', stderr: err.stderr?.toString() ?? '' };
      }
    },
    async onVerifySelf(expression: string): Promise<boolean> {
      console.log(`  [verify] ${truncate(expression, 100)}`);
      return true;
    },
    async onEdgeEval(expression: string): Promise<boolean> {
      console.log(`  [edge]   ${expression}`);
      return true;
    },
    onEvent(event: GesEvent) {
      switch (event.type) {
        case 'node_enter': console.log(`\n> ${event.node}`); break;
        case 'node_exit':  console.log(`  -> ${event.edge_to}`); break;
        case 'action_skip': console.log(`  [skip] ${event.action}: ${event.reason}`); break;
        case 'skill_enter':   console.log(`  [call]  → ${event.target} (from ${event.caller_node}.${event.caller_action})`); break;
        case 'skill_exit':    console.log(`  [return] ← ${event.target} (output: ${event.output_keys.join(', ') || 'none'})`); break;
        case 'handoff_ready': console.log(`  [handoff] → ${event.target}`); break;
        case 'verify_fail': console.log(`  [FAIL] ${event.action}`); break;
        case 'fork': console.log(`  [fork] ${event.from} → [${event.targets.join(', ')}]`); break;
        case 'join': console.log(`  [join] [${event.sources.join(', ')}] → ${event.to}`); break;
        case 'goal_eval': console.log(`  [goal] ${event.expression} = ${event.result}`); break;
        case 'stuck': console.error(`  STUCK at ${event.node}`); break;
        case 'done': console.log('\nGraph complete.'); break;
      }
    },
  };
}

// ── handoff ──

function cmdHandoff(args: string[]) {
  const session = requireSession(args[0], 'handoff');
  const skip = args.includes('--skip');
  const statePath = resolve(session.stateDir, 'graph-state.yaml');
  const state = loadState(statePath);

  if (!state) { console.error('Session has no state.'); process.exit(1); }
  if (!state.handoff || state.handoff.status !== 'pending') {
    console.error('No pending handoff in this session.');
    process.exit(1);
  }

  if (skip) {
    state.handoff.status = 'skipped';
    saveState(state, statePath);
    console.log(`Handoff to "${state.handoff.target}" skipped.`);
    return;
  }

  const targetPath = resolve(dirname(session.gesFile), state.handoff.target);
  const targetGraph = loadGraph(targetPath);
  const { id, stateDir } = createSession(targetPath, targetGraph.meta.name);

  const executor = new GesExecutor({
    gesFile: targetPath,
    stateDir,
    handlers: createCliHandlers(),
  });
  for (const [k, v] of Object.entries(state.handoff.payload)) {
    executor.setVariable(k, v);
  }

  state.handoff.status = 'accepted';
  saveState(state, statePath);

  console.log(`Handoff accepted → ${targetGraph.meta.name}`);
  console.log(`  New session: ${id}`);
  console.log(`  Payload: ${JSON.stringify(state.handoff.payload).slice(0, 100)}`);
  console.log(`\nNext: ges next ${id.slice(0, 12)}`);
}

function printHandoffHint(state: GesState, sessionId: string) {
  if (!state.handoff || state.handoff.status !== 'pending') return;
  console.log('');
  console.log(`Handoff → ${state.handoff.target}`);
  console.log(`  Payload: ${JSON.stringify(state.handoff.payload).slice(0, 100)}`);
  console.log(`  Accept: ges handoff ${sessionId.slice(0, 12)}`);
  console.log(`  Skip:   ges handoff ${sessionId.slice(0, 12)} --skip`);
}

// ── Helpers ──

function requireSession(idOrPrefix: string | undefined, cmd: string) {
  if (!idOrPrefix) { console.error(`Usage: ges ${cmd} <session-id>`); process.exit(1); }
  const session = resolveSession(idOrPrefix);
  if (!session) { console.error(`Session not found: "${idOrPrefix}". Use: ges list`); process.exit(1); }
  return session;
}

function formatActive(active: Record<string, string | null | '__done__'>): string {
  const entries = Object.entries(active);
  if (entries.length === 0) return '(none)';
  if (entries.length === 1) {
    const [node, action] = entries[0];
    if (action === '__done__') return `${node} ✓`;
    return action ? `${node}.${action}` : node;
  }
  return entries.map(([k, v]) => v === '__done__' ? `${k}✓` : k).join(' | ');
}

function pad(s: string, len: number): string { return s.padEnd(len); }
function truncate(s: string, max: number): string {
  const one = s.replace(/\n/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '...' : one;
}

main().catch(err => { console.error(`Fatal: ${err.message}`); process.exit(1); });

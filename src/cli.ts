#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { GesExecutor } from './executor.ts';
import { loadGraph } from './loader.ts';
import { loadState } from './state.ts';
import { createSession, listSessions, resolveSession } from './sessions.ts';
import type { GesEvent, ExecutorHandlers, PromptContext, RunResult } from './types.ts';

const [,, command, ...args] = process.argv;

const USAGE = `
ges — Graph-Enhanced Skill Executor

Session commands:
  ges load <file.ges.yaml>       Load graph, create session (auto ID)
  ges list                       List all sessions
  ges next <id>                  Advance one step (by session ID or prefix)
  ges complete <id>              Complete current node, transition to next
  ges run <id>                   Run to completion

Inspection:
  ges status <id>                Show session state
  ges validate <file.ges.yaml>   Validate GES file
  ges viz <file.ges.yaml>        Print mermaid diagram
`.trim();

async function main() {
  switch (command) {
    case 'load':     return cmdLoad(args);
    case 'list':
    case 'ls':       return cmdList();
    case 'next':     return await cmdNext(args);
    case 'complete': return await cmdComplete(args);
    case 'run':      return await cmdRun(args);
    case 'status':   return cmdStatus(args);
    case 'validate': return cmdValidate(args);
    case 'viz':      return cmdViz(args);
    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

// ── load: create session with auto ID ──

function cmdLoad(args: string[]) {
  const gesFile = args[0];
  if (!gesFile) { console.error('Usage: ges load <file.ges.yaml>'); process.exit(1); }

  const graph = loadGraph(gesFile);
  const { id, stateDir } = createSession(gesFile, graph.meta.name);

  console.log(`Session created: ${id}`);
  console.log(`  graph: ${graph.meta.name} (${Object.keys(graph.nodes).length} nodes, ${graph.edges.length} edges)`);
  console.log(`  dir:   ${stateDir}`);
  console.log(`\nNext: ges next ${id.slice(0, 12)}`);
}

// ── list: show all sessions ──

function cmdList() {
  const sessions = listSessions();
  if (sessions.length === 0) {
    console.log('No sessions. Use: ges load <file.ges.yaml>');
    return;
  }

  const col = { id: 28, node: 16, action: 16, iter: 5 };
  console.log(
    pad('ID', col.id) + pad('NODE', col.node) + pad('ACTION', col.action) + pad('ITER', col.iter) + 'SOURCE',
  );
  console.log('-'.repeat(col.id + col.node + col.action + col.iter + 20));

  for (const s of sessions) {
    console.log(
      pad(s.id, col.id) +
      pad(s.current_node, col.node) +
      pad(!s.current_action || s.current_action === '__done__' ? '-' : s.current_action, col.action) +
      pad(String(s.iteration), col.iter) +
      s.source,
    );
  }
}

// ── next: advance one action ──

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
  } else {
    const actionLabel = state.current_action && state.current_action !== '__done__' ? '.' + state.current_action : '';
    console.log(`State: ${state.current_node}${actionLabel} (iter=${state.iteration})`);
    console.log(`Next:  ges next ${session.id.slice(0, 12)}`);
  }
}

// ── complete: finish current node, evaluate edges, transition ──

async function cmdComplete(args: string[]) {
  const session = requireSession(args[0], 'complete');
  const handlers = createCliHandlers();

  const executor = new GesExecutor({
    gesFile: session.gesFile,
    stateDir: session.stateDir,
    handlers,
    resume: true,
  });

  const state = executor.getState();
  const startNode = state.current_node;

  // Execute remaining actions in current node, then transition
  let result = await executor.step();
  while (!result.done && executor.getState().current_node === startNode) {
    result = await executor.step();
  }

  const newState = executor.getState();
  console.log('');
  if (result.done) {
    console.log(`Done. Node "${startNode}" completed → terminal.`);
  } else {
    console.log(`Node "${startNode}" completed → "${newState.current_node}"`);
    console.log(`Next: ges next ${session.id.slice(0, 12)}`);
  }
}

// ── run: execute to completion ──

async function cmdRun(args: string[]) {
  const idOrFile = args[0];
  if (!idOrFile) { console.error('Usage: ges run <session-id | file.ges.yaml>'); process.exit(1); }

  let gesFile: string;
  let stateDir: string;
  let resume = false;

  // If it looks like a .yaml file, create session first
  if (idOrFile.endsWith('.yaml') || idOrFile.endsWith('.yml')) {
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
  console.log(`\nDone. Final: ${finalState.current_node}`);
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
  const nodeNames = Object.keys(graph.nodes);
  const terminalSet = new Set(graph.meta.terminal);
  const isDone = terminalSet.has(state.current_node);

  console.log(`Session:  ${session.id}`);
  console.log(`Source:   ${state.source}`);
  console.log(`Status:   ${isDone ? 'DONE' : 'RUNNING'}`);
  console.log(`Node:     ${state.current_node}`);
  console.log(`Action:   ${!state.current_action || state.current_action === '__done__' ? '(between nodes)' : state.current_action}`);
  console.log(`Iter:     ${state.iteration}`);
  console.log(`Vars:     ${Object.keys(state.variables).join(', ') || '(empty)'}`);
  console.log(`Stack:    ${state.call_stack.length} frames`);
  console.log(`\nGraph: ${nodeNames.join(' → ')}`);

  if (!isDone) {
    console.log(`\nNext: ges next ${session.id.slice(0, 12)}`);
  }
}

// ── validate ──

function cmdValidate(args: string[]) {
  const gesFile = args[0];
  if (!gesFile) { console.error('Usage: ges validate <file.ges.yaml>'); process.exit(1); }

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
  if (!gesFile) { console.error('Usage: ges viz <file.ges.yaml>'); process.exit(1); }

  const graph = loadGraph(gesFile);
  const lines: string[] = ['graph TD'];

  for (const [id, node] of Object.entries(graph.nodes)) {
    lines.push(`  ${id}["${id} (${node.actions.length})"]`);
  }
  for (const t of graph.meta.terminal) {
    lines.push(`  ${t}(("${t}"))`);
  }
  for (const edge of graph.edges) {
    const label = edge.when ? `|${edge.when}|` : '';
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
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
        case 'verify_fail': console.log(`  [FAIL] ${event.action}`); break;
        case 'stuck': console.error(`  STUCK at ${event.node}`); break;
        case 'done': console.log('\nGraph complete.'); break;
      }
    },
  };
}

// ── Helpers ──

function requireSession(idOrPrefix: string | undefined, cmd: string) {
  if (!idOrPrefix) { console.error(`Usage: ges ${cmd} <session-id>`); process.exit(1); }
  const session = resolveSession(idOrPrefix);
  if (!session) { console.error(`Session not found: "${idOrPrefix}". Use: ges list`); process.exit(1); }
  return session;
}

function pad(s: string, len: number): string { return s.padEnd(len); }
function truncate(s: string, max: number): string {
  const one = s.replace(/\n/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '...' : one;
}

main().catch(err => { console.error(`Fatal: ${err.message}`); process.exit(1); });

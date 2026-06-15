import { resolve, dirname } from 'node:path';
import type {
  GesGraph, GesState, GesAction, GesNode, GesEvent,
  ExecutorHandlers, PromptContext,
} from './types.js';
import { loadGraph, loadPrompt } from './loader.js';
import { createState, loadState, saveState } from './state.js';
import { expandRun, expandTemplate } from './bindings.js';

export interface ExecutorOptions {
  gesFile: string;
  stateDir: string;
  handlers: ExecutorHandlers;
  resume?: boolean;
}

export class GesExecutor {
  private graph: GesGraph;
  private state: GesState;
  private gesFile: string;
  private stateFile: string;
  private handlers: ExecutorHandlers;
  private bindings: Record<string, string>;

  constructor(opts: ExecutorOptions) {
    this.gesFile = resolve(opts.gesFile);
    this.graph = loadGraph(this.gesFile);
    this.bindings = this.graph.bindings ?? {};
    this.handlers = opts.handlers;
    this.stateFile = resolve(opts.stateDir, 'graph-state.yaml');

    if (opts.resume) {
      const saved = loadState(this.stateFile);
      if (saved) {
        this.state = saved;
      } else {
        this.state = createState(this.graph.meta.name, this.graph.meta.entry);
      }
    } else {
      this.state = createState(this.graph.meta.name, this.graph.meta.entry);
    }
  }

  async run(maxIterations = 1000): Promise<GesState> {
    let iterations = 0;
    while (!this.isTerminal(this.state.current_node)) {
      if (++iterations > maxIterations) {
        throw new Error(`Max iterations (${maxIterations}) exceeded at node "${this.state.current_node}"`);
      }

      const node = this.graph.nodes[this.state.current_node];
      if (!node) throw new Error(`Node not found: ${this.state.current_node}`);

      this.emit({ type: 'node_enter', node: this.state.current_node });

      await this.executeNode(this.state.current_node, node);

      const nextNode = await this.evaluateEdges(this.state.current_node);
      this.emit({ type: 'node_exit', node: this.state.current_node, edge_to: nextNode });

      this.state.current_node = nextNode;
      this.state.current_action = null;
      this.state.iteration = iterations;
      this.persist();
    }

    this.emit({ type: 'done' });
    return this.state;
  }

  // ── Single step mode: advance one action at a time ──

  async step(): Promise<{ done: boolean; event: GesEvent }> {
    if (this.isTerminal(this.state.current_node)) {
      const ev: GesEvent = { type: 'done' };
      this.emit(ev);
      return { done: true, event: ev };
    }

    const node = this.graph.nodes[this.state.current_node];
    if (!node) throw new Error(`Node not found: ${this.state.current_node}`);

    const actionIndex = this.currentActionIndex(node);

    if (actionIndex >= node.actions.length) {
      // All actions done → evaluate edges
      const nextNode = await this.evaluateEdges(this.state.current_node);
      const ev: GesEvent = { type: 'node_exit', node: this.state.current_node, edge_to: nextNode };
      this.emit(ev);
      this.state.current_node = nextNode;
      this.state.current_action = null;
      this.persist();
      return { done: this.isTerminal(nextNode), event: ev };
    }

    const action = node.actions[actionIndex];
    this.emit({ type: 'node_enter', node: this.state.current_node });
    await this.executeAction(this.state.current_node, action);

    const nextIdx = actionIndex + 1;
    this.state.current_action = nextIdx < node.actions.length
      ? node.actions[nextIdx].id
      : '__done__';
    this.persist();

    const ev: GesEvent = { type: 'action_done', node: this.state.current_node, action: action.id };
    return { done: false, event: ev };
  }

  getState(): GesState { return this.state; }
  getGraph(): GesGraph { return this.graph; }

  // ── Internals ──

  private async executeNode(nodeId: string, node: GesNode): Promise<void> {
    const startIdx = this.currentActionIndex(node);

    for (let i = startIdx; i < node.actions.length; i++) {
      const action = node.actions[i];
      this.state.current_action = action.id;

      if (action.loop) {
        await this.executeLoop(nodeId, action);
      } else {
        await this.executeAction(nodeId, action);
      }

      this.persist();
    }
  }

  private async executeLoop(nodeId: string, action: GesAction): Promise<void> {
    const items = this.resolveExpression(action.loop!.over);
    if (!Array.isArray(items)) {
      throw new Error(`Loop over "${action.loop!.over}" did not resolve to array`);
    }

    for (const item of items) {
      this.state.variables[action.loop!.as] = item;
      await this.executeAction(nodeId, action);
    }
  }

  private async executeAction(nodeId: string, action: GesAction): Promise<void> {
    const ctx = this.context(nodeId, action.id);
    const hasRun = !!action.run;
    const hasPrompt = !!action.prompt;
    const mode = hasRun && hasPrompt ? 'prompt+run' : hasRun ? 'run' : 'prompt';

    this.emit({ type: 'action_start', node: nodeId, action: action.id, mode });

    let result: string | undefined;

    try {
      if (hasRun && hasPrompt) {
        // run + prompt: tool executes with prompt as input
        const cmd = this.expandCommand(action.run!);
        const promptText = this.resolvePrompt(action.prompt!);
        const runResult = await this.handlers.onRun(cmd, promptText);
        result = runResult.stdout;
      } else if (hasRun) {
        const cmd = this.expandCommand(action.run!);
        const runResult = await this.handlers.onRun(cmd);
        result = runResult.stdout;
      } else if (hasPrompt) {
        const promptText = this.resolvePrompt(action.prompt!);
        result = await this.handlers.onPrompt(promptText, ctx);
      }
    } catch (err) {
      if (action.optional) {
        this.emit({ type: 'action_skip', node: nodeId, action: action.id, reason: String(err) });
        return;
      }
      throw err;
    }

    // Capture outputs
    if (action.output && result) {
      for (const key of action.output) {
        this.state.variables[key] = tryParseJson(result) ?? result;
      }
    }

    // Verify
    if (action.verify) {
      const passed = await this.runVerify(action.verify, ctx);
      if (passed) {
        this.emit({ type: 'verify_pass', node: nodeId, action: action.id });
      } else {
        this.emit({ type: 'verify_fail', node: nodeId, action: action.id, detail: JSON.stringify(action.verify) });
        if (!action.optional) {
          throw new Error(`Verify failed for ${nodeId}.${action.id}`);
        }
      }
    }

    this.emit({ type: 'action_done', node: nodeId, action: action.id, output: action.output ? pick(this.state.variables, action.output) : undefined });
  }

  private async runVerify(verify: string | { run: string }, ctx: PromptContext): Promise<boolean> {
    if (typeof verify === 'string') {
      return this.handlers.onVerifySelf(verify, ctx);
    }
    const cmd = this.expandCommand(verify.run);
    const result = await this.handlers.onRun(cmd);
    return result.exitCode === 0;
  }

  private async evaluateEdges(fromNode: string): Promise<string> {
    const candidates = this.graph.edges.filter(e => e.from === fromNode);
    if (candidates.length === 0) {
      this.emit({ type: 'stuck', node: fromNode, edges_tried: 0 });
      throw new Error(`STUCK: no edges from node "${fromNode}"`);
    }

    const ctx = this.context(fromNode, '');

    for (const edge of candidates) {
      let result: boolean;
      if (!edge.when) {
        result = true;
      } else {
        result = await this.handlers.onEdgeEval(
          expandTemplate(edge.when, this.state.variables),
          ctx,
        );
      }
      this.emit({ type: 'edge_eval', from: edge.from, to: edge.to, when: edge.when, result });
      if (result) return edge.to;
    }

    this.emit({ type: 'stuck', node: fromNode, edges_tried: candidates.length });
    throw new Error(`STUCK: no matching edge from "${fromNode}" (tried ${candidates.length} edges)`);
  }

  private expandCommand(run: string): string {
    return expandTemplate(expandRun(run, this.bindings), this.state.variables);
  }

  private resolvePrompt(prompt: string): string {
    const isPath = prompt.startsWith('./') || prompt.startsWith('../');
    const raw = isPath ? loadPrompt(prompt, this.gesFile) : prompt;
    return expandTemplate(raw, this.state.variables);
  }

  private resolveExpression(expr: string): unknown {
    const expanded = expandTemplate(expr, this.state.variables);
    const value = this.state.variables[expanded.replace(/^\{\{|\}\}$/g, '').trim()];
    return value ?? expanded;
  }

  private context(nodeId: string, actionId: string): PromptContext {
    return {
      variables: this.state.variables,
      current_node: nodeId,
      current_action: actionId,
      iteration: this.state.iteration,
    };
  }

  private currentActionIndex(node: GesNode): number {
    if (!this.state.current_action) return 0;
    if (this.state.current_action === '__done__') return node.actions.length;
    const idx = node.actions.findIndex(a => a.id === this.state.current_action);
    return idx >= 0 ? idx : node.actions.length;
  }

  private isTerminal(nodeId: string): boolean {
    return this.graph.meta.terminal.includes(nodeId);
  }

  private persist(): void {
    saveState(this.state, this.stateFile);
  }

  private emit(event: GesEvent): void {
    this.handlers.onEvent?.(event);
  }
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in obj) result[k] = obj[k];
  }
  return result;
}

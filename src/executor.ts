import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  GesGraph, GesState, GesAction, GesNode, GesEdge, GesEvent,
  ExecutorHandlers, PromptContext,
} from './types.js';
import { loadGraph, loadPrompt } from './loader.js';
import { createState, loadState, saveState, activeNode } from './state.js';
import { expandRun, expandTemplate } from './bindings.js';

export interface ExecutorOptions {
  gesFile: string;
  stateDir: string;
  handlers: ExecutorHandlers;
  resume?: boolean;
}

function toArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
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
    while (true) {
      if (++iterations > maxIterations) {
        throw new Error(`Max iterations (${maxIterations}) exceeded`);
      }

      const pending = this.pendingNodes();
      if (pending.length === 0) {
        const joinEdge = this.findJoinEdge();
        if (!joinEdge) {
          this.emit({ type: 'done' });
          return this.state;
        }
        this.applyJoin(joinEdge);
        this.state.iteration = iterations;
        this.persist();
        continue;
      }

      for (const nodeId of pending) {
        if (this.isTerminal(nodeId)) {
          this.state.active[nodeId] = '__done__';
          continue;
        }

        const node = this.graph.nodes[nodeId];
        if (!node) throw new Error(`Node not found: ${nodeId}`);

        this.emit({ type: 'node_enter', node: nodeId });
        await this.executeNode(nodeId, node);
        this.state.active[nodeId] = '__done__';

        if (pending.length === 1) {
          const edges = await this.evaluateEdges(nodeId);
          const edge = edges[0];
          const targets = toArray(edge.to);

          if (targets.length > 1) {
            this.emit({ type: 'fork', from: nodeId, targets });
            delete this.state.active[nodeId];
            for (const t of targets) this.state.active[t] = null;
          } else {
            this.emit({ type: 'node_exit', node: nodeId, edge_to: targets[0] });
            this.processHandoff(edge);
            delete this.state.active[nodeId];
            this.state.active[targets[0]] = null;
          }
        }
      }

      if (this.allTerminal()) {
        this.emit({ type: 'done' });
        return this.state;
      }

      this.state.iteration = iterations;
      this.persist();
    }
  }

  // ── Single step mode ──

  async step(): Promise<{ done: boolean; event: GesEvent }> {
    const pending = this.pendingNodes();

    if (pending.length === 0) {
      const joinEdge = this.findJoinEdge();
      if (!joinEdge) {
        const ev: GesEvent = { type: 'done' };
        this.emit(ev);
        return { done: true, event: ev };
      }
      const ev = this.applyJoin(joinEdge);
      this.persist();
      return { done: this.allTerminal(), event: ev };
    }

    const nodeId = pending[0];

    if (this.isTerminal(nodeId)) {
      this.state.active[nodeId] = '__done__';
      this.persist();
      if (this.allTerminal()) {
        const ev: GesEvent = { type: 'done' };
        this.emit(ev);
        return { done: true, event: ev };
      }
      return { done: false, event: { type: 'node_exit', node: nodeId, edge_to: '(terminal)' } };
    }

    const node = this.graph.nodes[nodeId];
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const actionId = this.state.active[nodeId];
    const actionIndex = this.resolveActionIndex(node, actionId);

    if (actionIndex >= node.actions.length) {
      if (pending.length > 1 || this.isJoinSource(nodeId)) {
        this.state.active[nodeId] = '__done__';
        this.persist();
        return { done: false, event: { type: 'node_exit', node: nodeId, edge_to: '(join)' } };
      }

      const edges = await this.evaluateEdges(nodeId);
      const edge = edges[0];
      const targets = toArray(edge.to);

      if (targets.length > 1) {
        const ev: GesEvent = { type: 'fork', from: nodeId, targets };
        this.emit(ev);
        delete this.state.active[nodeId];
        for (const t of targets) this.state.active[t] = null;
        this.persist();
        return { done: false, event: ev };
      }

      const ev: GesEvent = { type: 'node_exit', node: nodeId, edge_to: targets[0] };
      this.emit(ev);
      this.processHandoff(edge);
      delete this.state.active[nodeId];
      this.state.active[targets[0]] = null;
      this.persist();
      return { done: this.isTerminal(targets[0]), event: ev };
    }

    const action = node.actions[actionIndex];
    this.emit({ type: 'node_enter', node: nodeId });
    await this.executeAction(nodeId, action);

    const nextIdx = actionIndex + 1;
    if (nextIdx < node.actions.length) {
      this.state.active[nodeId] = node.actions[nextIdx].id;
    } else if (pending.length > 1 || this.isJoinSource(nodeId)) {
      this.state.active[nodeId] = '__done__';
    } else {
      this.state.active[nodeId] = '__edges__';
    }
    this.persist();

    return { done: false, event: { type: 'action_done', node: nodeId, action: action.id } };
  }

  getState(): GesState { return this.state; }
  getGraph(): GesGraph { return this.graph; }
  setVariable(key: string, value: unknown): void { this.state.variables[key] = value; }

  // ── Internals ──

  private pendingNodes(): string[] {
    return Object.entries(this.state.active)
      .filter(([, v]) => v !== '__done__')
      .map(([k]) => k);
  }

  private allTerminal(): boolean {
    return Object.keys(this.state.active).every(k => this.isTerminal(k));
  }

  private isJoinSource(nodeId: string): boolean {
    return this.graph.edges.some(e => {
      const fromArr = toArray(e.from);
      return fromArr.length > 1 && fromArr.includes(nodeId);
    });
  }

  private findJoinEdge(): GesEdge | null {
    const doneNodes = new Set(
      Object.entries(this.state.active)
        .filter(([, v]) => v === '__done__')
        .map(([k]) => k),
    );
    for (const edge of this.graph.edges) {
      const fromArr = toArray(edge.from);
      if (fromArr.length > 1 && fromArr.every(n => doneNodes.has(n))) {
        return edge;
      }
    }
    return null;
  }

  private applyJoin(edge: GesEdge): GesEvent {
    const sources = toArray(edge.from);
    const joinTarget = toArray(edge.to)[0];
    this.emit({ type: 'join', sources, to: joinTarget });

    for (const s of sources) delete this.state.active[s];
    this.state.active[joinTarget] = null;

    return { type: 'join', sources, to: joinTarget };
  }

  private async executeNode(nodeId: string, node: GesNode): Promise<void> {
    const startIdx = this.resolveActionIndex(node, this.state.active[nodeId]);

    for (let i = startIdx; i < node.actions.length; i++) {
      const action = node.actions[i];
      this.state.active[nodeId] = action.id;

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
    const isSkillCall = hasRun && isGesFile(expandRun(action.run!, this.bindings));
    const mode = isSkillCall ? 'skill_call' : hasRun && hasPrompt ? 'prompt+run' : hasRun ? 'run' : 'prompt';

    this.emit({ type: 'action_start', node: nodeId, action: action.id, mode });

    let result: string | undefined;

    try {
      if (isSkillCall) {
        result = await this.executeSkillCall(nodeId, action);
      } else if (hasRun && hasPrompt) {
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

    if (action.output && result) {
      for (const key of action.output) {
        this.state.variables[key] = tryParseJson(result) ?? result;
      }
    }

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

  private async executeSkillCall(callerNode: string, action: GesAction): Promise<string | undefined> {
    const rawTarget = expandRun(action.run!, this.bindings);
    const targetPath = resolve(dirname(this.gesFile), expandTemplate(rawTarget, this.state.variables));
    const targetGraph = loadGraph(targetPath);
    const childName = targetGraph.meta.name;
    const childStateFile = resolve(dirname(this.stateFile), `graph-state.${childName}.yaml`);

    this.state.call_stack.push({
      caller_node: callerNode,
      caller_action: action.id,
      target: childName,
      child_state_file: childStateFile,
    });
    this.persist();

    this.emit({ type: 'skill_enter', target: childName, caller_node: callerNode, caller_action: action.id });

    const childExecutor = new GesExecutor({
      gesFile: targetPath,
      stateDir: dirname(childStateFile),
      handlers: this.handlers,
      resume: existsSync(childStateFile),
    });

    if (action.prompt) {
      childExecutor.setVariable('_input', this.resolvePrompt(action.prompt));
    }

    const childFinal = await childExecutor.run();

    const exportKeys = targetGraph.meta.output ?? Object.keys(childFinal.variables);
    const captureKeys = action.output ?? exportKeys;
    const allowedKeys = captureKeys.filter(k => exportKeys.includes(k));

    for (const key of allowedKeys) {
      if (key in childFinal.variables) {
        this.state.variables[key] = childFinal.variables[key];
      }
    }

    this.emit({ type: 'skill_exit', target: childName, output_keys: allowedKeys });

    this.state.call_stack.pop();
    this.persist();

    return allowedKeys.length > 0 ? JSON.stringify(pick(childFinal.variables, allowedKeys)) : undefined;
  }

  private async runVerify(verify: string | { run: string }, ctx: PromptContext): Promise<boolean> {
    if (typeof verify === 'string') {
      return this.handlers.onVerifySelf(verify, ctx);
    }
    const cmd = this.expandCommand(verify.run);
    const result = await this.handlers.onRun(cmd);
    return result.exitCode === 0;
  }

  private async evaluateEdges(fromNode: string): Promise<GesEdge[]> {
    const candidates = this.graph.edges.filter(e => {
      const fromArr = toArray(e.from);
      return fromArr.length === 1 && fromArr[0] === fromNode;
    });

    if (candidates.length === 0) {
      this.emit({ type: 'stuck', node: fromNode, edges_tried: 0 });
      throw new Error(`STUCK: no edges from node "${fromNode}"`);
    }

    const ctx = this.context(fromNode, '');

    if (this.graph.meta.goal) {
      const goalResult = await this.handlers.onEdgeEval(
        expandTemplate(this.graph.meta.goal, this.state.variables),
        ctx,
      );
      this.state.variables['goal'] = goalResult;
      this.emit({ type: 'goal_eval', expression: this.graph.meta.goal, result: goalResult });
    }

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
      if (result) return [edge];
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

  private resolveActionIndex(node: GesNode, actionId: string | null | '__done__' | '__edges__'): number {
    if (!actionId) return 0;
    if (actionId === '__done__' || actionId === '__edges__') return node.actions.length;
    const idx = node.actions.findIndex(a => a.id === actionId);
    return idx >= 0 ? idx : node.actions.length;
  }

  private processHandoff(edge: GesEdge): void {
    if (!edge.handoff) return;

    const outputKeys = this.graph.meta.output ?? Object.keys(this.state.variables);
    const payload = pick(this.state.variables, outputKeys);

    const targetPath = resolve(dirname(this.gesFile), edge.handoff);
    if (existsSync(targetPath)) {
      const targetGraph = loadGraph(targetPath);
      if (targetGraph.meta.input) {
        validateInput(payload, targetGraph.meta.input, targetGraph.meta.name);
      }
    }

    this.state.handoff = { target: edge.handoff, payload, status: 'pending' };
    this.emit({ type: 'handoff_ready', target: edge.handoff, payload });
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

function isGesFile(ref: string): boolean {
  const lower = ref.split(/\s/)[0].toLowerCase();
  return lower.endsWith('.ges.yaml') || lower.endsWith('.ges.yml');
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

function validateInput(payload: Record<string, unknown>, schema: { required?: string[]; properties: Record<string, { default?: unknown }> }, skillName: string): void {
  for (const key of schema.required ?? []) {
    if (!(key in payload) || payload[key] === undefined || payload[key] === null) {
      const def = schema.properties[key]?.default;
      if (def !== undefined) {
        payload[key] = def;
      } else {
        throw new Error(`Handoff to "${skillName}": missing required input "${key}"`);
      }
    }
  }
}

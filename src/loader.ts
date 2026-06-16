import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { GesGraph } from './types.js';

export function loadGraph(filePath: string): GesGraph {
  const absPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    throw new Error(`GES file not found: ${absPath}`);
  }
  const raw = readFileSync(absPath, 'utf-8');
  const graph = parseYaml(raw) as GesGraph;
  validate(graph, absPath);
  return graph;
}

export function resolvePromptPath(promptRef: string, gesFilePath: string): string {
  if (!promptRef.startsWith('./') && !promptRef.startsWith('../')) return promptRef;
  return resolve(dirname(gesFilePath), promptRef);
}

export function loadPrompt(promptRef: string, gesFilePath: string): string {
  const absPath = resolvePromptPath(promptRef, gesFilePath);
  if (!existsSync(absPath)) {
    throw new Error(`Prompt file not found: ${absPath} (referenced from ${gesFilePath})`);
  }
  return readFileSync(absPath, 'utf-8');
}

function toArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}

function validate(graph: GesGraph, filePath: string): void {
  const errors: string[] = [];

  if (graph.schema !== 'ges/1.1') {
    errors.push(`Invalid schema: expected "ges/1.1", got "${graph.schema}"`);
  }
  if (!graph.meta?.name) errors.push('meta.name is required');
  if (!graph.meta?.entry) errors.push('meta.entry is required');
  if (!graph.meta?.terminal?.length) errors.push('meta.terminal must have at least one entry');

  if (!graph.nodes || Object.keys(graph.nodes).length === 0) {
    errors.push('At least one node is required');
  }

  if (graph.meta?.entry && graph.nodes && !graph.nodes[graph.meta.entry]) {
    errors.push(`Entry node "${graph.meta.entry}" not found in nodes`);
  }

  const nodeIds = new Set(Object.keys(graph.nodes ?? {}));
  const terminalIds = new Set(graph.meta?.terminal ?? []);
  const allIds = new Set([...nodeIds, ...terminalIds]);

  for (const edge of graph.edges ?? []) {
    for (const f of toArray(edge.from)) {
      if (!allIds.has(f)) errors.push(`Edge from unknown node: "${f}"`);
    }
    for (const t of toArray(edge.to)) {
      if (!allIds.has(t)) errors.push(`Edge to unknown node: "${t}"`);
    }

    const fromArr = toArray(edge.from);
    const toArr = toArray(edge.to);
    if (fromArr.length > 1 && toArr.length > 1) {
      errors.push(`Edge cannot have both from[] and to[] as arrays (from: [${fromArr}], to: [${toArr}])`);
    }

    if (edge.handoff && toArr.length > 1) {
      errors.push(`Handoff edge cannot fork to multiple targets`);
    }
  }

  for (const [nodeId, node] of Object.entries(graph.nodes ?? {})) {
    if (!node.actions?.length) {
      errors.push(`Node "${nodeId}" has no actions`);
    }
    const actionIds = new Set<string>();
    for (const action of node.actions ?? []) {
      if (!action.id) errors.push(`Action in node "${nodeId}" missing id`);
      if (actionIds.has(action.id)) errors.push(`Duplicate action id "${action.id}" in node "${nodeId}"`);
      actionIds.add(action.id);
      if (!action.prompt && !action.run) {
        errors.push(`Action "${action.id}" in node "${nodeId}" must have prompt or run`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`GES validation failed for ${filePath}:\n  - ${errors.join('\n  - ')}`);
  }
}

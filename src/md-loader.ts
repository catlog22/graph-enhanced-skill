import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { GesGraph, GesEdge, GesNode, GesAction, GesMeta } from './types.js';

export function loadMarkdownGraph(filePath: string): GesGraph {
  const absPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    throw new Error(`GES file not found: ${absPath}`);
  }
  const raw = readFileSync(absPath, 'utf-8');
  return parseGesMarkdown(raw, absPath);
}

export function parseGesMarkdown(source: string, filePath = '<inline>'): GesGraph {
  const { frontmatter, body } = extractFrontmatter(source);
  const graphBlock = extractGraphBlock(body);
  if (!graphBlock) {
    throw new Error(`GES Markdown missing <graph> block in ${filePath}`);
  }

  // Pass 1: build GesGraph from frontmatter + graph tags
  const graph = buildGraph(frontmatter, graphBlock, filePath);

  // Pass 2: inject prompts from ## [ref] sections
  const prompts = extractPrompts(body);
  injectPrompts(graph, prompts, filePath);

  return graph;
}

// ── Frontmatter ──

function extractFrontmatter(source: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: source };
  }
  const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
  return { frontmatter, body: match[2] };
}

// ── Graph block ──

function extractGraphBlock(body: string): string | null {
  const match = body.match(/<graph>([\s\S]*?)<\/graph>/i);
  return match ? match[1] : null;
}

function buildGraph(fm: Record<string, unknown>, graphXml: string, filePath: string): GesGraph {
  const schema = (fm.schema as string) ?? 'ges/2.0';
  if (schema !== 'ges/2.0') {
    throw new Error(`GES Markdown requires schema "ges/2.0", got "${schema}" in ${filePath}`);
  }

  const name = fm.name as string;
  if (!name) throw new Error(`Missing "name" in frontmatter of ${filePath}`);

  const nodes: Record<string, GesNode> = {};
  const edges: GesEdge[] = [];
  let entry: string | null = null;
  const terminals: string[] = [];

  // Parse <node> tags
  const nodeRegex = /<node\s+([^>]*?)(\/>|>([\s\S]*?)<\/node>)/gi;
  let nodeMatch: RegExpExecArray | null;
  while ((nodeMatch = nodeRegex.exec(graphXml)) !== null) {
    const attrs = parseAttrs(nodeMatch[1]);
    const nodeId = attrs.id;
    if (!nodeId) throw new Error(`<node> missing id in ${filePath}`);

    if ('entry' in attrs) {
      if (entry) throw new Error(`Multiple entry nodes: "${entry}" and "${nodeId}" in ${filePath}`);
      entry = nodeId;
    }
    if ('terminal' in attrs) {
      terminals.push(nodeId);
    }

    const innerHtml = nodeMatch[3] ?? '';
    const isTerminalNode = 'terminal' in attrs;
    const actions = isTerminalNode && !innerHtml.trim() && !attrs.run
      ? []
      : parseNodeActions(nodeId, attrs, innerHtml);
    nodes[nodeId] = { actions };
  }

  if (!entry) throw new Error(`No entry node (missing "entry" attribute) in ${filePath}`);
  if (terminals.length === 0) throw new Error(`No terminal nodes in ${filePath}`);

  // Parse <edge> tags
  const edgeRegex = /<edge\s+([^>]*?)\/?\s*>/gi;
  let edgeMatch: RegExpExecArray | null;
  while ((edgeMatch = edgeRegex.exec(graphXml)) !== null) {
    const attrs = parseAttrs(edgeMatch[1]);
    if (!attrs.from || !attrs.to) throw new Error(`<edge> missing from/to in ${filePath}`);

    const toArr = splitComma(attrs.to);
    edges.push({
      from: attrs.from,
      to: toArr.length > 1 ? toArr : toArr[0],
      ...(attrs.when ? { when: attrs.when } : {}),
      ...(attrs.handoff ? { handoff: attrs.handoff } : {}),
    });
  }

  // Parse <join> tags
  const joinRegex = /<join\s+([^>]*?)\/?\s*>/gi;
  let joinMatch: RegExpExecArray | null;
  while ((joinMatch = joinRegex.exec(graphXml)) !== null) {
    const attrs = parseAttrs(joinMatch[1]);
    if (!attrs.from || !attrs.to) throw new Error(`<join> missing from/to in ${filePath}`);

    edges.push({
      from: splitComma(attrs.from),
      to: attrs.to,
    });
  }

  const meta: GesMeta = {
    name,
    entry,
    terminal: terminals,
    ...(fm.goal ? { goal: fm.goal as string } : {}),
    ...(fm.output ? { output: fm.output as string[] } : {}),
    ...(fm.input ? { input: fm.input as GesMeta['input'] } : {}),
    ...(fm.description ? { description: fm.description as string } : {}),
  };

  const graph: GesGraph = {
    schema: 'ges/2.0',
    meta,
    nodes,
    edges,
    ...(fm.bindings ? { bindings: fm.bindings as Record<string, string> } : {}),
  };

  return graph;
}

function parseNodeActions(nodeId: string, nodeAttrs: Record<string, string>, innerHtml: string): GesAction[] {
  // Check for nested <action> tags
  const actionRegex = /<action\s+([^>]*?)\/?\s*>/gi;
  const actions: GesAction[] = [];
  let actionMatch: RegExpExecArray | null;

  while ((actionMatch = actionRegex.exec(innerHtml)) !== null) {
    const attrs = parseAttrs(actionMatch[1]);
    if (!attrs.id) throw new Error(`<action> missing id in node "${nodeId}"`);
    actions.push(buildAction(attrs));
  }

  if (actions.length > 0) return actions;

  // 1:1 shorthand: no nested actions, node itself is the action
  const action = buildAction({ id: nodeId, ...nodeAttrs });
  delete (action as any).entry;
  delete (action as any).terminal;
  return [action];
}

function buildAction(attrs: Record<string, string>): GesAction {
  const action: GesAction = { id: attrs.id };

  if (attrs.run) action.run = attrs.run;
  if (attrs.output) action.output = splitComma(attrs.output);
  if (attrs.verify) action.verify = attrs.verify;
  if (attrs.optional === 'true' || attrs.optional === '') action.optional = true;
  if (attrs.retry) action.retry = parseInt(attrs.retry, 10);
  if (attrs.timeout) action.timeout = parseInt(attrs.timeout, 10);

  if (attrs.loop) {
    const loopMatch = attrs.loop.match(/over:\s*(.+?)\s*,\s*as:\s*(.+)/);
    if (loopMatch) {
      action.loop = { over: loopMatch[1], as: loopMatch[2] };
    }
  }

  return action;
}

// ── Prompt extraction ──

function extractPrompts(body: string): Map<string, string> {
  const prompts = new Map<string, string>();
  const headingRegex = /^## \[([^\]]+)\]\s*$/gm;
  const matches: { ref: string; index: number }[] = [];

  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(body)) !== null) {
    matches.push({ ref: m[1], index: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length
      ? body.lastIndexOf('\n## [', matches[i + 1].index)
      : body.length;
    const content = body.slice(start, end).trim();
    if (content) {
      prompts.set(matches[i].ref, content);
    }
  }

  return prompts;
}

function injectPrompts(graph: GesGraph, prompts: Map<string, string>, filePath: string): void {
  for (const [ref, content] of prompts) {
    const dotIdx = ref.indexOf('.');
    let nodeId: string;
    let actionId: string;

    if (dotIdx >= 0) {
      nodeId = ref.slice(0, dotIdx);
      actionId = ref.slice(dotIdx + 1);
    } else {
      nodeId = ref;
      actionId = ref;
    }

    const node = graph.nodes[nodeId];
    if (!node) {
      throw new Error(`Prompt ## [${ref}] references unknown node "${nodeId}" in ${filePath}`);
    }

    const action = node.actions.find(a => a.id === actionId);
    if (!action) {
      throw new Error(`Prompt ## [${ref}] references unknown action "${actionId}" in node "${nodeId}" in ${filePath}`);
    }

    action.prompt = content;
  }
}

// ── Utils ──

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w[\w-]*)(?:\s*=\s*"([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(attrString)) !== null) {
    attrs[m[1]] = m[2] ?? '';
  }
  return attrs;
}

function splitComma(s: string): string[] {
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

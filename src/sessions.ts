import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { GesState } from './types.js';

const SESSIONS_ROOT = '.ges-sessions';

export interface SessionInfo {
  id: string;
  source: string;
  gesFile: string;
  stateDir: string;
  current_node: string;
  current_action: string | null;
  iteration: number;
  created_at: string;
}

export function sessionsRoot(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), SESSIONS_ROOT);
}

export function generateSessionId(name: string): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const rand = randomBytes(2).toString('hex');
  return `${name}-${ts}-${rand}`;
}

export function createSession(gesFile: string, name: string, cwd?: string): { id: string; stateDir: string } {
  const id = generateSessionId(name);
  const stateDir = resolve(sessionsRoot(cwd), id);
  mkdirSync(stateDir, { recursive: true });

  const meta = { gesFile: resolve(gesFile), created_at: new Date().toISOString() };
  const metaPath = resolve(stateDir, 'session-meta.json');
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return { id, stateDir };
}

export function listSessions(cwd?: string): SessionInfo[] {
  const root = sessionsRoot(cwd);
  if (!existsSync(root)) return [];

  const dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
  const sessions: SessionInfo[] = [];

  for (const dir of dirs) {
    const stateDir = resolve(root, dir.name);
    const metaPath = resolve(stateDir, 'session-meta.json');
    const statePath = resolve(stateDir, 'graph-state.yaml');

    if (!existsSync(metaPath)) continue;

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    let state: Partial<GesState> = {};
    if (existsSync(statePath)) {
      state = parseYaml(readFileSync(statePath, 'utf-8')) as GesState;
    }

    sessions.push({
      id: dir.name,
      source: state.source ?? '(not started)',
      gesFile: meta.gesFile,
      stateDir,
      current_node: state.current_node ?? meta.gesFile,
      current_action: state.current_action ?? null,
      iteration: state.iteration ?? 0,
      created_at: meta.created_at,
    });
  }

  return sessions.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function resolveSession(idOrPrefix: string, cwd?: string): SessionInfo | null {
  const all = listSessions(cwd);
  const exact = all.find(s => s.id === idOrPrefix);
  if (exact) return exact;
  const prefixed = all.filter(s => s.id.startsWith(idOrPrefix));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

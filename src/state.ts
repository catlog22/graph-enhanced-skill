import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { GesState } from './types.js';

export function createState(source: string, entryNode: string): GesState {
  return {
    schema: 'ges-runtime/1.1',
    source,
    active: { [entryNode]: null },
    iteration: 0,
    variables: {},
    call_stack: [],
  };
}

export function activeNode(state: GesState): string {
  const nodes = Object.keys(state.active).filter(k => state.active[k] !== '__done__');
  return nodes[0] ?? Object.keys(state.active)[0];
}

export function activeAction(state: GesState): string | null {
  const node = activeNode(state);
  return state.active[node] ?? null;
}

export function loadState(filePath: string): GesState | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  return parseYaml(raw) as GesState;
}

export function saveState(state: GesState, filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(filePath)) {
    try {
      const backupDir = resolve(dir, '.backups');
      if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      copyFileSync(filePath, resolve(backupDir, `graph-state.${ts}.bak`));
    } catch { /* backup failure is non-fatal */ }
  }

  const content = stringifyYaml(state);
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, content, 'utf-8');
  try {
    renameSync(tmpPath, filePath);
  } catch (err: any) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      writeFileSync(filePath, content, 'utf-8');
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    } else {
      throw err;
    }
  }
}

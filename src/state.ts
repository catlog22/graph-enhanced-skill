import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { GesState } from './types.ts';

export function createState(source: string, entryNode: string): GesState {
  return {
    schema: 'ges-runtime/1.0',
    source,
    current_node: entryNode,
    current_action: null,
    iteration: 0,
    variables: {},
    call_stack: [],
  };
}

export function loadState(filePath: string): GesState | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8');
  return parseYaml(raw) as GesState;
}

export function saveState(state: GesState, filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Protected Data Store: backup → write temp → rename
  if (existsSync(filePath)) {
    const backupDir = resolve(dir, '.backups');
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(filePath, resolve(backupDir, `graph-state.${ts}.bak`));
  }

  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, stringifyYaml(state), 'utf-8');
  renameSync(tmpPath, filePath);
}

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { expandTemplate } from './bindings.js';
import type { GesPlatformConfig, GesPlatformTool } from './types.js';

const PLATFORM_FILENAMES = ['ges.platform.yaml', 'ges.platform.yml'];

export function loadPlatform(searchDir?: string): GesPlatformConfig | null {
  const dir = searchDir ?? process.cwd();

  for (const name of PLATFORM_FILENAMES) {
    const filePath = resolve(dir, name);
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const config = parseYaml(raw) as GesPlatformConfig;
      validatePlatform(config, filePath);
      return config;
    }
  }

  return null;
}

export function loadPlatformFrom(filePath: string): GesPlatformConfig {
  if (!existsSync(filePath)) {
    throw new Error(`Platform config not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf-8');
  const config = parseYaml(raw) as GesPlatformConfig;
  validatePlatform(config, filePath);
  return config;
}

export interface ResolvedTool {
  command: string;
  input?: string;
  mode: 'cli' | 'native';
}

export function resolveTool(
  toolType: string,
  params: Record<string, unknown>,
  prompt: string | undefined,
  platform: GesPlatformConfig | null,
): ResolvedTool {
  if (!platform) {
    throw new Error(`Tool call "${toolType}" requires a platform config (ges.platform.yaml)`);
  }

  const tool = platform.tools[toolType];
  if (!tool) {
    throw new Error(`Tool type "${toolType}" not defined in platform "${platform.platform}"`);
  }

  if (tool.resolve === 'native') {
    return { command: toolType, mode: 'native', input: prompt };
  }

  const vars: Record<string, unknown> = { ...params };
  if (prompt) vars['prompt'] = prompt;

  const command = expandTemplate(tool.resolve, vars);
  const input = tool.input === 'stdin' ? prompt : undefined;

  return { command, mode: 'cli', input };
}

function validatePlatform(config: GesPlatformConfig, filePath: string): void {
  const errors: string[] = [];

  if (!config.version) errors.push('version is required');
  if (!config.platform) errors.push('platform name is required');
  if (!config.tools || Object.keys(config.tools).length === 0) {
    errors.push('at least one tool definition is required');
  }

  for (const [name, tool] of Object.entries(config.tools ?? {})) {
    if (!tool.resolve) errors.push(`tool "${name}": resolve is required`);
  }

  if (errors.length > 0) {
    throw new Error(`Platform config validation failed (${filePath}):\n  - ${errors.join('\n  - ')}`);
  }
}

export function listToolTypes(platform: GesPlatformConfig | null): string[] {
  if (!platform) return [];
  return Object.keys(platform.tools);
}

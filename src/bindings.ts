export function expandRun(run: string, bindings: Record<string, string>): string {
  const parts = run.match(/^("?)(\S+)\1(.*)$/s);
  if (!parts) return run;

  const [, , firstWord, rest] = parts;
  if (firstWord in bindings) {
    return bindings[firstWord] + rest;
  }
  return run;
}

export function expandTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, expr: string) => {
    const trimmed = expr.trim();
    const value = resolvePath(trimmed, variables);
    if (value === undefined || value === null) return match;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function resolvePath(path: string, obj: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

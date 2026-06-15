export interface GesGraph {
  schema: 'ges/1.0';
  meta: GesMeta;
  bindings?: Record<string, string>;
  defaults?: Record<string, unknown>;
  nodes: Record<string, GesNode>;
  edges: GesEdge[];
}

export interface GesMeta {
  name: string;
  entry: string;
  terminal: string[];
  description?: string;
  input?: GesInputSchema;
}

export interface GesInputSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, { type: string; description?: string; default?: unknown }>;
}

export interface GesNode {
  actions: GesAction[];
  description?: string;
  persist?: string[];
}

export interface GesAction {
  id: string;
  prompt?: string;
  run?: string;
  output?: string[];
  verify?: string | { run: string };
  loop?: { over: string; as: string };
  optional?: boolean;
  retry?: number;
  timeout?: number;
  tools?: GesDecisionTool[];
}

export interface GesDecisionTool {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface GesEdge {
  from: string;
  to: string;
  when?: string;
  label?: string;
  handoff?: GesHandoff;
}

export interface GesHandoff {
  target: string;
  map: Record<string, unknown>;
}

// ── Runtime State ──

export interface GesState {
  schema: 'ges-runtime/1.0';
  source: string;
  current_node: string;
  current_action: string | null;
  iteration: number;
  variables: Record<string, unknown>;
  call_stack: CallFrame[];
  handoff?: GesHandoffState | null;
}

export interface GesHandoffState {
  target: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'skipped';
}

export interface CallFrame {
  caller_node: string;
  caller_action: string;
  target: string;
  child_state_file: string;
}

// ── Executor Events ──

export type GesEvent =
  | { type: 'node_enter'; node: string }
  | { type: 'node_exit'; node: string; edge_to: string }
  | { type: 'action_start'; node: string; action: string; mode: 'prompt' | 'run' | 'prompt+run' | 'skill_call' }
  | { type: 'action_done'; node: string; action: string; output?: Record<string, unknown> }
  | { type: 'action_skip'; node: string; action: string; reason: string }
  | { type: 'skill_enter'; target: string; caller_node: string; caller_action: string }
  | { type: 'skill_exit'; target: string; output_keys: string[] }
  | { type: 'handoff_ready'; target: string; payload: Record<string, unknown> }
  | { type: 'verify_pass'; node: string; action: string }
  | { type: 'verify_fail'; node: string; action: string; detail: string }
  | { type: 'edge_eval'; from: string; to: string; when: string | undefined; result: boolean }
  | { type: 'stuck'; node: string; edges_tried: number }
  | { type: 'done' };

export interface ExecutorHandlers {
  onPrompt(instruction: string, context: PromptContext): Promise<string>;
  onRun(command: string, input?: string): Promise<RunResult>;
  onVerifySelf(expression: string, context: PromptContext): Promise<boolean>;
  onEdgeEval(expression: string, context: PromptContext): Promise<boolean>;
  onEvent?(event: GesEvent): void;
}

export interface PromptContext {
  variables: Record<string, unknown>;
  current_node: string;
  current_action: string;
  iteration: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

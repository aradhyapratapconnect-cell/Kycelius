export type PermissionSetting = 'auto' | 'confirm_required' | 'never';
export type DeclaredTier = 'auto' | 'confirm_required';

export const TIER_OPTIONS: readonly {
  value: PermissionSetting;
  label: string;
  hint: string;
}[] = [
  { value: 'auto', label: 'Always Allow', hint: 'Runs without asking' },
  { value: 'confirm_required', label: 'Ask Every Time', hint: 'Asks before running' },
  { value: 'never', label: 'Never Allow', hint: 'Blocked entirely' },
];

const TOOL_LABELS: Record<string, string> = {
  delete_file: 'Delete files',
  run_shell_command: 'Run shell commands',
  send_email: 'Send email',
  create_file: 'Create files',
  open_application: 'Open applications',
  github_read: 'GitHub (read only)',
  github_write: 'GitHub (write)',
  test_auto_tool: 'Self-test (automatic)',
  test_confirm_tool: 'Self-test (confirm)',
};

const DANGEROUS_TOOLS = new Set(['delete_file', 'run_shell_command']);

/** User-facing label for a tool, falling back to the snake_case name. */
export function toolDisplayLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, ' ');
}

/**
 * T-21: rows default to the tool's declared tier — auto tools start as
 * "Always Allow", confirm_required tools as "Ask Every Time". Nothing
 * defaults to "Never Allow".
 */
export function defaultSettingFor(declaredTier: DeclaredTier): PermissionSetting {
  return declaredTier;
}

/** delete_file and run_shell_command show a danger note in every tier. */
export function isDangerousTool(toolName: string): boolean {
  return DANGEROUS_TOOLS.has(toolName);
}

export const DANGER_NOTE =
  'Deletes or executes can permanently modify or destroy files. Use with care in every tier.';
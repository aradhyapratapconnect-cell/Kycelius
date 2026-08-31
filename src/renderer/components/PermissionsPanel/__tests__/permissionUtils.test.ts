import { describe, expect, it } from 'vitest';
import {
  DANGER_NOTE,
  defaultSettingFor,
  isDangerousTool,
  TIER_OPTIONS,
  toolDisplayLabel,
} from '../permissionUtils';

describe('permissionUtils', () => {
  it('maps snake_case tool names to user-facing labels', () => {
    expect(toolDisplayLabel('delete_file')).toBe('Delete files');
    expect(toolDisplayLabel('run_shell_command')).toBe('Run shell commands');
    expect(toolDisplayLabel('send_email')).toBe('Send email');
    expect(toolDisplayLabel('create_file')).toBe('Create files');
    expect(toolDisplayLabel('open_application')).toBe('Open applications');
    expect(toolDisplayLabel('github_read')).toBe('GitHub (read only)');
    expect(toolDisplayLabel('github_write')).toBe('GitHub (write)');
  });

  it('falls back to a readable name for unknown tools', () => {
    expect(toolDisplayLabel('custom_thing')).toBe('custom thing');
    expect(toolDisplayLabel('plain')).toBe('plain');
  });

  it('defaults a row to its declared tier — auto stays Always Allow, no Never Allow by default', () => {
    expect(defaultSettingFor('auto')).toBe('auto');
    expect(defaultSettingFor('confirm_required')).toBe('confirm_required');
    for (const option of TIER_OPTIONS) {
      if (option.value !== 'never') {
        expect([defaultSettingFor('auto'), defaultSettingFor('confirm_required')]).toContain(
          option.value
        );
      }
    }
  });

  it('flags only delete_file and run_shell_command as dangerous', () => {
    expect(isDangerousTool('delete_file')).toBe(true);
    expect(isDangerousTool('run_shell_command')).toBe(true);
    expect(isDangerousTool('send_email')).toBe(false);
    expect(isDangerousTool('create_file')).toBe(false);
    expect(isDangerousTool('github_write')).toBe(false);
  });

  it('exposes the three tiers in Always Allow / Ask Every Time / Never Allow order', () => {
    expect(TIER_OPTIONS.map(o => o.value)).toEqual([
      'auto',
      'confirm_required',
      'never',
    ]);
    expect(DANGER_NOTE).toMatch(/delete|execute/i);
  });
});
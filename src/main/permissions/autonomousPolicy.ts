// Autonomous Mode risk-tolerance policy (F-11), per Security & Access
// Document §4: a confirm_required tool skips confirmation only when BOTH
// (1) the master Autonomous Mode toggle is on, and
// (2) THIS specific tool is marked "auto" ("Always Allow") in tool_overrides.
// "never" blocks before anything else can help — nothing overrides it.
//
// The config is read live on every check — never cached — so a user changing
// an override mid-plan applies to the next step's permission check and can't
// retroactively affect steps already past theirs.

import { autonomousModeConfig, type AutonomousModeConfig } from '../db/db';

export type OverrideTier = 'auto' | 'confirm_required' | 'never';

export type AutonomousPolicySource = () => AutonomousModeConfig;
export type AutonomousOverrideWriter = (toolName: string, tier: OverrideTier) => void;

let source: AutonomousPolicySource = () => autonomousModeConfig.get();

/** Tests inject a fake config source; production reads the DB live. */
export function configureAutonomousPolicy(next: AutonomousPolicySource): void {
  source = next;
}

let writer: AutonomousOverrideWriter = (toolName, tier) => {
  const config = autonomousModeConfig.get();
  autonomousModeConfig.set({
    tool_overrides: { ...config.tool_overrides, [toolName]: tier },
  });
};

/** Tests inject a fake writer; production writes the shared store (T-21). */
export function configureAutonomousOverrideWriter(next: AutonomousOverrideWriter): void {
  writer = next;
}

/** The user's current tier for a tool, or undefined when untouched. */
export function getAutonomousOverride(toolName: string): OverrideTier | undefined {
  return source().tool_overrides?.[toolName];
}

/** Persist one action's tier to the single shared permission store. */
export function writeAutonomousOverride(toolName: string, tier: OverrideTier): void {
  writer(toolName, tier);
}

export function isAutoApprovedUnderAutonomousMode(toolName: string): boolean {
  const config = source();
  if (!config || config.enabled !== true) return false;
  return config.tool_overrides?.[toolName] === 'auto';
}
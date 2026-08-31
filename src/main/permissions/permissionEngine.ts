import {
  enqueueConfirmation,
  resolveConfirmation,
  getPendingConfirmations,
  type ConfirmationResponse,
  type QueuedConfirmation,
} from './confirmationQueue';
import type { ExecutionGate } from '../tools/toolRegistry';
import {
  getAutonomousOverride,
  isAutoApprovedUnderAutonomousMode,
  writeAutonomousOverride,
} from './autonomousPolicy';

export interface PendingConfirmationNotice {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  permissionTier: 'confirm_required';
  timestamp: number;
}

type NotifyFn = (confirmation: PendingConfirmationNotice) => void;

let notifyRenderer: NotifyFn = () => {};

export function installPermissionEngine(options: { notify: NotifyFn }): void {
  notifyRenderer = options.notify;
}

function toNotice(confirmation: QueuedConfirmation): PendingConfirmationNotice {
  return {
    id: confirmation.id,
    toolName: confirmation.toolName,
    parameters: confirmation.parameters,
    permissionTier: 'confirm_required',
    timestamp: confirmation.enqueuedAt,
  };
}

export const permissionGate: ExecutionGate = async context => {
  // T-21: the effective tier is the user's per-action choice when set,
  // otherwise the tool's declared tier. "Never Allow" always wins — checked
  // first, before tier/auto logic and regardless of Autonomous Mode.
  const override = getAutonomousOverride(context.toolName);
  const effective = override ?? context.permissionTier;

  if (effective === 'never') {
    return {
      decision: 'deny',
      reason:
        'This action is blocked by your Permissions setting ("Never Allow"). Change it in Settings to allow it again.',
    };
  }

  if (effective === 'auto') {
    // Inherently-automatic tools run as designed. A confirm_required tool only
    // skips the pause when the user opted it into "Always Allow" AND the
    // Autonomous Mode master toggle is on (F-11 / Security doc §4).
    if (
      context.permissionTier === 'auto' ||
      isAutoApprovedUnderAutonomousMode(context.toolName)
    ) {
      return { decision: 'proceed' };
    }
  }

  const { confirmation, response } = enqueueConfirmation({
    id: context.executionId,
    toolName: context.toolName,
    parameters: context.params,
  });

  notifyRenderer(toNotice(confirmation));

  const resolved = await response;

  switch (resolved.action) {
    case 'approve':
      return { decision: 'proceed' };
    // T-21/T-04: "Always Allow" approves this instance AND persists that
    // choice to the shared permission store — the same store the Permissions
    // panel reads, so the two entry points can never drift apart.
    case 'always_allow':
      writeAutonomousOverride(context.toolName, 'auto');
      return { decision: 'proceed' };
    case 'edit':
      return { decision: 'proceed_with_params', params: resolved.editedParams ?? {} };
    case 'deny':
      return { decision: 'deny', reason: resolved.reason ?? 'denied by user' };
  }
};

export function respondToConfirmation(id: string, response: ConfirmationResponse): boolean {
  return resolveConfirmation(id, response);
}

export function getPendingConfirmationNotices(): PendingConfirmationNotice[] {
  return getPendingConfirmations().map(toNotice);
}

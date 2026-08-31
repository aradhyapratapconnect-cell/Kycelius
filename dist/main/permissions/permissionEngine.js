"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissionGate = void 0;
exports.installPermissionEngine = installPermissionEngine;
exports.respondToConfirmation = respondToConfirmation;
exports.getPendingConfirmationNotices = getPendingConfirmationNotices;
const confirmationQueue_1 = require("./confirmationQueue");
const autonomousPolicy_1 = require("./autonomousPolicy");
let notifyRenderer = () => { };
function installPermissionEngine(options) {
    notifyRenderer = options.notify;
}
function toNotice(confirmation) {
    return {
        id: confirmation.id,
        toolName: confirmation.toolName,
        parameters: confirmation.parameters,
        permissionTier: 'confirm_required',
        timestamp: confirmation.enqueuedAt,
    };
}
const permissionGate = async (context) => {
    // T-21: the effective tier is the user's per-action choice when set,
    // otherwise the tool's declared tier. "Never Allow" always wins — checked
    // first, before tier/auto logic and regardless of Autonomous Mode.
    const override = (0, autonomousPolicy_1.getAutonomousOverride)(context.toolName);
    const effective = override ?? context.permissionTier;
    if (effective === 'never') {
        return {
            decision: 'deny',
            reason: 'This action is blocked by your Permissions setting ("Never Allow"). Change it in Settings to allow it again.',
        };
    }
    if (effective === 'auto') {
        // Inherently-automatic tools run as designed. A confirm_required tool only
        // skips the pause when the user opted it into "Always Allow" AND the
        // Autonomous Mode master toggle is on (F-11 / Security doc §4).
        if (context.permissionTier === 'auto' ||
            (0, autonomousPolicy_1.isAutoApprovedUnderAutonomousMode)(context.toolName)) {
            return { decision: 'proceed' };
        }
    }
    const { confirmation, response } = (0, confirmationQueue_1.enqueueConfirmation)({
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
            (0, autonomousPolicy_1.writeAutonomousOverride)(context.toolName, 'auto');
            return { decision: 'proceed' };
        case 'edit':
            return { decision: 'proceed_with_params', params: resolved.editedParams ?? {} };
        case 'deny':
            return { decision: 'deny', reason: resolved.reason ?? 'denied by user' };
    }
};
exports.permissionGate = permissionGate;
function respondToConfirmation(id, response) {
    return (0, confirmationQueue_1.resolveConfirmation)(id, response);
}
function getPendingConfirmationNotices() {
    return (0, confirmationQueue_1.getPendingConfirmations)().map(toNotice);
}

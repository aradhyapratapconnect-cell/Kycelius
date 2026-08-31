"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock('electron', () => ({ app: {} }));
vitest_1.vi.mock('../../db/db', () => ({ autonomousModeConfig: { get: () => ({}) } }));
const permissionEngine_1 = require("../permissionEngine");
const autonomousPolicy_1 = require("../autonomousPolicy");
const confirmationQueue_1 = require("../confirmationQueue");
function setPolicy(enabled, overrides) {
    (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
        enabled,
        tool_overrides: overrides,
        max_plan_steps: 10,
        max_plan_duration_seconds: 300,
    }));
}
/** Starts a gate check for a confirm_required tool without awaiting it. */
function startGateCheck(toolName, executionId = `exec-${toolName}`) {
    return (0, permissionEngine_1.permissionGate)({
        executionId,
        toolName,
        permissionTier: 'confirm_required',
        params: {},
    });
}
(0, vitest_1.describe)('autonomousMode override policy', () => {
    (0, vitest_1.it)('requires BOTH the master toggle and a per-tool "auto" mark', () => {
        const cases = [
            [false, { send_email: 'auto' }, false], // toggle off wins
            [true, {}, false], // nothing opted in
            [true, { send_email: 'confirm_required' }, false], // explicitly kept manual
            [true, { send_email: 'auto' }, true], // both conditions met
            [false, {}, false],
        ];
        for (const [enabled, overrides, expected] of cases) {
            setPolicy(enabled, overrides);
            (0, vitest_1.expect)((0, autonomousPolicy_1.isAutoApprovedUnderAutonomousMode)('send_email')).toBe(expected);
        }
    });
    (0, vitest_1.it)('re-reads the config live so mid-plan changes apply to future checks only', () => {
        setPolicy(false, { send_email: 'auto' });
        (0, vitest_1.expect)((0, autonomousPolicy_1.isAutoApprovedUnderAutonomousMode)('send_email')).toBe(false);
        // The user flips the toggle on between two steps...
        setPolicy(true, { send_email: 'auto' });
        (0, vitest_1.expect)((0, autonomousPolicy_1.isAutoApprovedUnderAutonomousMode)('send_email')).toBe(true);
    });
});
(0, vitest_1.describe)('permissionGate × Autonomous Mode (F-11)', () => {
    (0, vitest_1.beforeEach)(() => {
        setPolicy(false, {});
    });
    (0, vitest_1.afterEach)(() => {
        // Restore a safe "everything manual" policy for any later checks.
        (0, autonomousPolicy_1.configureAutonomousPolicy)(() => ({
            enabled: false,
            tool_overrides: {},
            max_plan_steps: 10,
            max_plan_duration_seconds: 300,
        }));
        (0, confirmationQueue_1.resetQueue)();
    });
    (0, vitest_1.it)('never skips confirmation while Autonomous Mode is off — even with an "auto" override stored', async () => {
        setPolicy(false, { delete_file: 'auto' });
        const pending = startGateCheck('delete_file');
        await Promise.resolve();
        // Paused: the tool sits in the confirmation queue awaiting the user.
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)().map(c => c.toolName)).toContain('delete_file');
        (0, confirmationQueue_1.resolveConfirmation)('exec-delete_file', { action: 'approve' });
        await (0, vitest_1.expect)(pending).resolves.toEqual({ decision: 'proceed' });
    });
    (0, vitest_1.it)('skips confirmation when the toggle is on AND this exact tool is marked "auto"', async () => {
        setPolicy(true, { create_file: 'auto', delete_file: 'confirm_required' });
        await (0, vitest_1.expect)(startGateCheck('create_file')).resolves.toEqual({ decision: 'proceed' });
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)()).toHaveLength(0);
    });
    (0, vitest_1.it)('still pauses tools that are not marked "auto" while the toggle is on', async () => {
        setPolicy(true, { create_file: 'auto' });
        const pending = startGateCheck('delete_file');
        await Promise.resolve();
        (0, vitest_1.expect)((0, confirmationQueue_1.getPendingConfirmations)().map(c => c.toolName)).toContain('delete_file');
        (0, confirmationQueue_1.resolveConfirmation)('exec-delete_file', { action: 'deny', reason: 'nope' });
        await (0, vitest_1.expect)(pending).resolves.toEqual({ decision: 'deny', reason: 'nope' });
    });
});

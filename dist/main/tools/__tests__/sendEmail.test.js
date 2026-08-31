"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const vitest_1 = require("vitest");
const { execMock, spawnMock } = vitest_1.vi.hoisted(() => ({
    execMock: vitest_1.vi.fn(),
    spawnMock: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('child_process', () => ({
    exec: execMock,
    spawn: spawnMock,
}));
vitest_1.vi.mock('../../db/db', () => ({
    toolExecutions: {
        create: vitest_1.vi.fn(),
        updateStatus: vitest_1.vi.fn(),
    },
}));
// Import after mocks are set up — this triggers registerTool
require("../sendEmail");
const toolRegistry_1 = require("../toolRegistry");
const sendEmail_1 = require("../sendEmail");
const db_1 = require("../../db/db");
const originalPlatform = process.platform;
function setPlatform(platform) {
    Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true });
}
function makeSpawnChild(exitCode = 0) {
    const child = new events_1.EventEmitter();
    child.killed = false;
    queueMicrotask(() => {
        if (exitCode === 0)
            child.emit('close', 0);
        else
            child.emit('error', new Error(`spawn failed (${exitCode})`));
    });
    return child;
}
function decodedPsScript(callIndex = 0) {
    const command = execMock.mock.calls[callIndex][0];
    const encoded = command.split('-EncodedCommand ')[1];
    (0, vitest_1.expect)(encoded).toBeDefined();
    return Buffer.from(encoded, 'base64').toString('utf16le');
}
const VALID_PARAMS = {
    to: 'friend@example.com',
    subject: 'Lunch',
    body: 'Want to grab lunch tomorrow?',
};
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    execMock.mockImplementation((_command, _opts, cb) => {
        if (typeof cb === 'function') {
            queueMicrotask(() => cb(null, ''));
        }
        return {};
    });
    spawnMock.mockImplementation(() => makeSpawnChild(0));
});
(0, vitest_1.afterEach)(() => {
    (0, toolRegistry_1.setExecutionGate)(null);
    setPlatform(originalPlatform);
});
(0, vitest_1.describe)('validateEmailAddress', () => {
    (0, vitest_1.it)('accepts normal addresses', () => {
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('person@example.com')).toBeNull();
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('  person@example.com  ')).toBeNull();
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('first.last+tag@sub.domain.co')).toBeNull();
    });
    (0, vitest_1.it)('rejects malformed addresses with clear messages', () => {
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('not-an-email')).toMatch(/not a valid email/);
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('missing@tld')).toMatch(/not a valid email/);
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('has space@example.com')).toMatch(/not a valid email/);
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('@example.com')).toMatch(/not a valid email/);
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)('')).toMatch(/must not be empty/);
        (0, vitest_1.expect)((0, sendEmail_1.validateEmailAddress)(undefined)).toMatch(/must be a string/);
    });
});
(0, vitest_1.describe)('send_email tool', () => {
    const tool = () => (0, toolRegistry_1.getTool)('send_email');
    (0, vitest_1.it)('is registered with confirm_required permission tier', () => {
        (0, vitest_1.expect)(tool()).toBeDefined();
        (0, vitest_1.expect)(tool().permissionTier).toBe('confirm_required');
    });
    (0, vitest_1.it)('rejects a malformed address BEFORE the confirmation gate ever fires', async () => {
        const gate = vitest_1.vi.fn(async () => ({ decision: 'proceed' }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const result = await (0, toolRegistry_1.getTool)('send_email').handler; // reference sanity
        (0, vitest_1.expect)(result).toBeTypeOf('function');
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        const outcome = await executeToolCall('send_email', { ...VALID_PARAMS, to: 'broken@@mail' });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/not a valid email/);
        (0, vitest_1.expect)(gate).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('runs semantic validation after user edits too (edited malformed address is rejected)', async () => {
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        setPlatform('darwin');
        const gate = vitest_1.vi.fn(async () => ({
            decision: 'proceed_with_params',
            params: { ...VALID_PARAMS, to: 'oops no at sign' },
        }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const outcome = await executeToolCall('send_email', { ...VALID_PARAMS });
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/Edited parameters rejected/);
        (0, vitest_1.expect)(spawnMock).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('opens PowerShell Start-Process on Windows with the encoded mailto URL', async () => {
        setPlatform('win32');
        const gate = vitest_1.vi.fn(async () => ({ decision: 'proceed' }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        const outcome = await executeToolCall('send_email', {
            to: 'friend@example.com',
            subject: 'Hello world',
            body: 'line one\nline two',
        });
        (0, vitest_1.expect)(outcome.success).toBe(true);
        const script = decodedPsScript(0);
        (0, vitest_1.expect)(script).toContain('Start-Process');
        (0, vitest_1.expect)(script).toContain('mailto:friend%40example.com'); // '@' encoded
        (0, vitest_1.expect)(script).toContain('subject=Hello%20world');
        (0, vitest_1.expect)(script).toContain('body=line%20one%0Aline%20two');
    });
    (0, vitest_1.it)('opens the draft via `open` on macOS', async () => {
        setPlatform('darwin');
        const gate = vitest_1.vi.fn(async () => ({ decision: 'proceed' }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        const outcome = await executeToolCall('send_email', VALID_PARAMS);
        (0, vitest_1.expect)(outcome.success).toBe(true);
        (0, vitest_1.expect)(spawnMock).toHaveBeenCalledWith('open', [vitest_1.expect.stringMatching(/^mailto:friend%40example\.com\?subject=Lunch&body=/)], vitest_1.expect.anything());
    });
    (0, vitest_1.it)('opens the draft via xdg-open on Linux', async () => {
        setPlatform('linux');
        const gate = vitest_1.vi.fn(async () => ({ decision: 'proceed' }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        const outcome = await executeToolCall('send_email', VALID_PARAMS);
        (0, vitest_1.expect)(outcome.success).toBe(true);
        (0, vitest_1.expect)(spawnMock).toHaveBeenCalledWith('xdg-open', [vitest_1.expect.stringContaining('mailto:')], vitest_1.expect.anything());
    });
    (0, vitest_1.it)('never claims "sent" or "delivered" on success', async () => {
        setPlatform('darwin');
        const gate = vitest_1.vi.fn(async () => ({ decision: 'proceed' }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        const outcome = await executeToolCall('send_email', VALID_PARAMS);
        (0, vitest_1.expect)(outcome.result).toMatch(/opened/i);
        (0, vitest_1.expect)(outcome.result).toMatch(/mail client/);
        (0, vitest_1.expect)(outcome.result).not.toMatch(/\bsent\b|\bdelivered\b/i);
    });
    (0, vitest_1.it)('denial results in no mail client action and a denied audit entry', async () => {
        setPlatform('darwin');
        const gate = vitest_1.vi.fn(async () => ({ decision: 'deny', reason: 'user said no' }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        const outcome = await executeToolCall('send_email', VALID_PARAMS);
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/not approved/);
        (0, vitest_1.expect)(spawnMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(execMock).not.toHaveBeenCalled();
        (0, vitest_1.expect)(db_1.toolExecutions.updateStatus).toHaveBeenCalledWith(vitest_1.expect.any(String), 'denied', vitest_1.expect.stringContaining('user said no'));
    });
    (0, vitest_1.it)('reports opener failures as typed errors instead of pretending success', async () => {
        setPlatform('darwin');
        spawnMock.mockImplementation(() => makeSpawnChild(1));
        const gate = vitest_1.vi.fn(async () => ({ decision: 'proceed' }));
        (0, toolRegistry_1.setExecutionGate)(gate);
        const { executeToolCall } = await Promise.resolve().then(() => __importStar(require('../toolRegistry')));
        const outcome = await executeToolCall('send_email', VALID_PARAMS);
        (0, vitest_1.expect)(outcome.success).toBe(false);
        (0, vitest_1.expect)(outcome.error).toMatch(/Could not open your mail client/);
    });
});

"use strict";
/**
 * T-07 — Tool: Draft & Send Email (v1 via OS mail client)
 *
 * Opens the user's default mail client with a pre-filled draft. Kyclius can
 * never confirm actual delivery this way, so the result wording always says
 * "opened in your mail client" — never "sent" or "delivered".
 *
 * permissionTier is confirm_required: the dialog shows the exact to/subject/
 * body before anything opens. Recipient format is checked by the registry's
 * pre-gate validate hook, so a malformed address fails BEFORE any dialog.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEmailAddress = validateEmailAddress;
const child_process_1 = require("child_process");
const toolRegistry_1 = require("./toolRegistry");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validateEmailAddress(value) {
    if (typeof value !== 'string') {
        return 'recipient "to" must be a string';
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return 'recipient "to" must not be empty';
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
        return `"${trimmed}" is not a valid email address`;
    }
    return null;
}
/** RFC-6068-style encoding: %20 for spaces (URLSearchParams would emit '+'). */
function buildMailtoUrl(to, subject, body) {
    return `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function encodePsScript(script) {
    return Buffer.from(script, 'utf16le').toString('base64');
}
function openWithPowerShell(url) {
    const safe = url.replace(/'/g, "''");
    return new Promise(resolve => {
        (0, child_process_1.exec)(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodePsScript(`Start-Process -FilePath '${safe}'`)}`, { windowsHide: true, timeout: 15_000 }, error => {
            resolve(error
                ? { success: false, error: `Could not open your mail client: ${error.message}` }
                : { success: true });
        });
    });
}
function openWithCommand(command, url) {
    // Array-form spawn (no shell) so URL contents can never inject commands.
    return new Promise(resolve => {
        const child = (0, child_process_1.spawn)(command, [url], { stdio: 'ignore' });
        child.on('error', err => {
            resolve({ success: false, error: `Could not open your mail client: ${err.message}` });
        });
        child.on('close', code => {
            resolve(code === 0
                ? { success: true }
                : { success: false, error: `Could not open your mail client (exit code ${code}).` });
        });
    });
}
function openMailClient(url) {
    switch (process.platform) {
        case 'win32':
            return openWithPowerShell(url);
        case 'darwin':
            return openWithCommand('open', url);
        default:
            return openWithCommand('xdg-open', url);
    }
}
(0, toolRegistry_1.registerTool)({
    name: 'send_email',
    description: 'Open a pre-filled email draft in the user\'s default mail client. This does NOT send the message — the user reviews and clicks send themselves. Use for drafting emails when asked.',
    parameters: {
        type: 'object',
        properties: {
            to: {
                type: 'string',
                description: 'Recipient email address, e.g. "person@example.com"',
            },
            subject: {
                type: 'string',
                description: 'Email subject line',
            },
            body: {
                type: 'string',
                description: 'Full email body text',
            },
        },
        required: ['to', 'subject', 'body'],
    },
    permissionTier: 'confirm_required',
    validate: params => validateEmailAddress(params.to),
    handler: async (params) => {
        const to = params.to;
        const subject = params.subject;
        const body = params.body;
        if (typeof subject !== 'string')
            return { success: false, error: 'subject must be a string' };
        if (typeof body !== 'string')
            return { success: false, error: 'body must be a string' };
        const addressError = validateEmailAddress(to);
        if (addressError)
            return { success: false, error: addressError };
        const mailtoUrl = buildMailtoUrl(to, subject, body);
        const outcome = await openMailClient(mailtoUrl);
        if (!outcome.success)
            return outcome;
        // Honest wording per spec: Kyclius opened a draft; it cannot verify sending.
        return {
            success: true,
            result: `Opened a pre-filled draft to ${to.trim()} in your mail client — review it there and click send.`,
        };
    },
});

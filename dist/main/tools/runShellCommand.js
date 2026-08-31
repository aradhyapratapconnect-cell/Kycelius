"use strict";
/**
 * T-09 — Tool: Run Shell Command (always confirm_required)
 *
 * Runs a shell command on the host OS using the OS-native shell
 * (PowerShell on Windows, zsh on macOS, bash on Linux). Safety design:
 *
 * - The syntax-mismatch check runs in the registry's pre-gate `validate`
 *   hook: a Unix-only command on Windows (or PowerShell/cmd-only syntax on
 *   macOS/Linux) is refused OUTRIGHT with a clear error — never silently
 *   "translated" and never shown to the user for confirmation.
 * - A hard timeout (default 30s, clamped to 1–300s) kills the process; a
 *   timed-out command is reported as timed out, never left hanging.
 * - Full stdout, stderr, and exit code are returned verbatim — no
 *   summarizing or truncation — so the user sees exactly what happened.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const toolRegistry_1 = require("./toolRegistry");
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 300;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Commands that only exist on Unix-like systems (first token match). */
const UNIX_ONLY_COMMANDS = new Set([
    'sudo', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'brew',
    'chmod', 'chown', 'which', 'grep', 'sed', 'awk', 'head', 'tail', 'wc',
    'ln', 'uname', 'df', 'du', 'free', 'ps', 'kill', 'pkill', 'nohup',
    'systemctl', 'service', 'export', 'source', 'alias', 'man', 'less',
    'nano', 'vim', 'gedit', 'xdg-open',
]);
/** Commands that only exist on Windows (first token match). */
const WINDOWS_ONLY_COMMANDS = new Set([
    'reg', 'regedit', 'cls', 'wmic', 'tasklist', 'taskkill', 'ipconfig',
    'sfc', 'dism', 'chkdsk', 'powershell', 'pwsh', 'cmd', 'notepad',
]);
/** PowerShell cmdlet shape (Get-ChildItem, Remove-Item, Write-Host, ...). */
const CMDLET_PATTERN = /^[A-Z][a-zA-Z]+-[A-Z][A-Za-z0-9]+$/;
/**
 * AC: if the LLM proposes command syntax mismatched to the detected OS,
 * surface that as an error rather than attempting a naive translation.
 * Runs pre-gate via the registry `validate` hook.
 */
function validateOsSyntax(command) {
    const trimmed = command.trim();
    const firstToken = trimmed.split(/\s+/)[0] ?? '';
    const firstTokenLower = firstToken.toLowerCase();
    if (process.platform === 'win32') {
        const looksUnix = UNIX_ONLY_COMMANDS.has(firstTokenLower) ||
            trimmed.includes('/dev/null') ||
            trimmed.startsWith('#!');
        if (looksUnix) {
            return `"${command}" looks like Unix/macOS shell syntax, but this machine runs Windows. Kycelius will not attempt an automatic translation — provide the equivalent PowerShell or cmd command instead.`;
        }
        return null;
    }
    const looksWindows = WINDOWS_ONLY_COMMANDS.has(firstTokenLower) ||
        /\.(exe|ps1|bat|cmd)$/i.test(firstToken) ||
        CMDLET_PATTERN.test(firstToken) ||
        trimmed.includes('$env:');
    if (looksWindows) {
        const osName = process.platform === 'darwin' ? 'macOS' : 'Linux';
        return `"${command}" looks like Windows/PowerShell-only syntax, but this machine runs ${osName}. Kycelius will not attempt an automatic translation — provide an equivalent bash/zsh command instead.`;
    }
    return null;
}
/** OS-correct native shell invocation (AC: automatic selection). */
function buildInvocation(command) {
    switch (process.platform) {
        case 'win32':
            // -NoProfile keeps startup fast and deterministic; -NonInteractive
            // guarantees nothing ever waits on stdin for a prompt.
            return {
                file: 'powershell.exe',
                args: ['-NoProfile', '-NonInteractive', '-Command', command],
            };
        case 'darwin':
            return { file: '/bin/zsh', args: ['-c', command] };
        default:
            return { file: '/bin/bash', args: ['-c', command] };
    }
}
function runCommand(file, args, options) {
    return new Promise(resolvePromise => {
        (0, child_process_1.execFile)(file, args, options, (error, stdout, stderr) => {
            if (!error) {
                resolvePromise({
                    code: 0,
                    killed: false,
                    signal: null,
                    stdout,
                    stderr,
                });
                return;
            }
            const err = error;
            resolvePromise({
                code: err.code ?? null,
                killed: err.killed === true,
                signal: err.signal ?? null,
                stdout: typeof stdout === 'string' ? stdout : '',
                stderr: typeof stderr === 'string'
                    ? stderr
                    : err.message ?? 'unknown error',
            });
        });
    });
}
(0, toolRegistry_1.registerTool)({
    name: 'run_shell_command',
    description: "Run a shell command on the user's machine using the OS-native shell " +
        '(PowerShell on Windows, zsh on macOS, bash on Linux). Always requires ' +
        'user confirmation. IMPORTANT: the command must use syntax valid for the ' +
        "detected host operating system — do not propose Unix commands on Windows " +
        'or PowerShell commands on macOS/Linux.',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The exact full command text to run, in host-OS shell syntax',
            },
            timeoutSeconds: {
                type: 'number',
                description: 'Optional hard timeout in seconds (1–300). Defaults to 30. The ' +
                    'process is killed when the timeout elapses.',
            },
        },
        required: ['command'],
    },
    permissionTier: 'confirm_required',
    validate: params => validateOsSyntax(String(params.command)),
    handler: async (params) => {
        const command = String(params.command);
        const requested = Number(params.timeoutSeconds);
        const seconds = Math.min(Math.max(Number.isFinite(requested) ? requested : DEFAULT_TIMEOUT_SECONDS, 1), MAX_TIMEOUT_SECONDS);
        const { file, args } = buildInvocation(command);
        const outcome = await runCommand(file, args, {
            timeout: seconds * 1000,
            maxBuffer: MAX_OUTPUT_BYTES,
        });
        const outputBlock = `--- stdout ---\n${outcome.stdout.length > 0 ? outcome.stdout : '(empty)'}\n` +
            `--- stderr ---\n${outcome.stderr.length > 0 ? outcome.stderr : '(empty)'}`;
        if (outcome.killed || outcome.signal !== null) {
            return {
                success: false,
                error: `Command timed out after ${seconds}s and was killed. Partial output:\n${outputBlock}`,
            };
        }
        if (typeof outcome.code === 'string') {
            const reason = outcome.code === 'ENOBUFS'
                ? 'Command output exceeded the capture limit and was aborted.'
                : `Failed to start shell "${file}".`;
            return {
                success: false,
                error: `${reason} ${outputBlock}`,
            };
        }
        return {
            success: true,
            result: `Exit code: ${String(outcome.code)}\n${outputBlock}`,
        };
    },
});

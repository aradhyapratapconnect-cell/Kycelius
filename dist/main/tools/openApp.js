"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const toolRegistry_1 = require("./toolRegistry");
function encodePsScript(script) {
    return Buffer.from(script, 'utf16le').toString('base64');
}
function runPs(script) {
    return new Promise(resolve => {
        (0, child_process_1.exec)(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodePsScript(script)}`, { windowsHide: true, timeout: 15_000 }, (error, stdout) => {
            resolve({ ok: !error, output: (stdout ?? '').trim() });
        });
    });
}
function psEscape(text) {
    return text.replace(/'/g, "''");
}
function findLinuxDesktopFile(appName) {
    const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
    const searchName = appName.toLowerCase().replace(/\s+/g, '-');
    for (const dir of dataDirs) {
        const desktopPath = (0, path_1.join)(dir, 'applications', `${searchName}.desktop`);
        if ((0, fs_1.existsSync)(desktopPath))
            return desktopPath;
    }
    const flatpakPath = (0, path_1.join)('/var/lib/flatpak/exports/share/applications', `${searchName}.desktop`);
    if ((0, fs_1.existsSync)(flatpakPath))
        return flatpakPath;
    return null;
}
/**
 * Windows resolution order:
 * 1. Get-StartApps (Start Menu database — knows every installed app incl. UWP)
 *    → launch via explorer.exe shell:AppsFolder\<AppID>
 * 2. where.exe PATH lookup → start the .exe directly
 */
async function launchWindows(appName) {
    const safe = psEscape(appName);
    const lookup = await runPs(`
    $apps = @(
      Get-StartApps | Where-Object { $_.Name -eq '${safe}' }
      Get-StartApps | Where-Object { $_.Name -like '*${safe}*' }
    ) | Select-Object -First 1
    if ($null -eq $apps) { Write-Output 'NOT_FOUND' }
    else { Write-Output ('FOUND|' + $apps.Name + '|' + $apps.AppID) }
  `);
    const line = lookup.output.split('\r\n').find(l => l.startsWith('FOUND|') || l === 'NOT_FOUND');
    if (line && line.startsWith('FOUND|')) {
        const withoutPrefix = line.slice('FOUND|'.length);
        const separatorIndex = withoutPrefix.lastIndexOf('|');
        const matchedName = separatorIndex > -1 ? withoutPrefix.slice(0, separatorIndex) : appName;
        const appId = separatorIndex > -1 ? withoutPrefix.slice(separatorIndex + 1) : '';
        if (appId) {
            // explorer.exe returns immediately; launching happens asynchronously.
            (0, child_process_1.exec)(`explorer.exe "shell:AppsFolder\\${appId}"`, { windowsHide: true });
            return { success: true, result: `Opened ${matchedName}` };
        }
        // Fallback: launch by display name
        return new Promise(resolve => {
            (0, child_process_1.exec)(`cmd.exe /c start "" "${matchedName}"`, { windowsHide: true }, error => {
                resolve(error
                    ? { success: false, error: `Found "${matchedName}" but failed to launch it` }
                    : { success: true, result: `Opened ${matchedName}` });
            });
        });
    }
    // Not in Start Menu — try PATH
    const exeName = appName.toLowerCase().endsWith('.exe') ? appName : `${appName}.exe`;
    try {
        const whereResult = (0, child_process_1.execSync)(`where "${exeName}"`, {
            stdio: 'pipe',
            windowsHide: true,
            timeout: 5_000,
        })
            .toString()
            .trim();
        if (whereResult) {
            const exePath = whereResult.split(/\r?\n/)[0].trim();
            return new Promise(resolve => {
                (0, child_process_1.exec)(`cmd.exe /c start "" "${exePath}"`, { windowsHide: true }, error => {
                    resolve(error
                        ? { success: false, error: `Failed to open "${appName}": ${error.message}` }
                        : { success: true, result: `Opened ${appName}` });
                });
            });
        }
    }
    catch {
        // not in PATH
    }
    return {
        success: false,
        error: `Application "${appName}" not found. Make sure it is installed and the name is correct.`,
    };
}
function launchMac(appName) {
    return new Promise(resolve => {
        (0, child_process_1.exec)(`open -a '${appName.replace(/'/g, "\\'")}'`, { windowsHide: true }, error => {
            resolve(error
                ? {
                    success: false,
                    error: error.message.toLowerCase().includes('unable to find') ||
                        error.message.toLowerCase().includes('not found')
                        ? `Application "${appName}" not found. Make sure it is installed and the name is correct.`
                        : `Failed to open "${appName}": ${error.message}`,
                }
                : { success: true, result: `Opened ${appName}` });
        });
    });
}
function launchLinux(appName) {
    return new Promise(resolve => {
        (0, child_process_1.exec)(`xdg-open '${appName.replace(/'/g, "\\'")}'`, { windowsHide: true }, error => {
            if (!error) {
                resolve({ success: true, result: `Opened ${appName}` });
                return;
            }
            const desktopFile = findLinuxDesktopFile(appName);
            if (desktopFile) {
                (0, child_process_1.exec)(`xdg-open '${desktopFile}'`, { windowsHide: true }, err2 => {
                    resolve(err2
                        ? { success: false, error: `Found "${appName}" but failed to launch it` }
                        : { success: true, result: `Opened ${appName}` });
                });
                return;
            }
            resolve({
                success: false,
                error: `Application "${appName}" not found. Make sure it is installed and the name is correct.`,
            });
        });
    });
}
(0, toolRegistry_1.registerTool)({
    name: 'open_application',
    description: 'Launch an installed application by name. Use the application name as the user would know it (e.g. "Visual Studio Code", "Spotify", "Firefox", "Calculator").',
    parameters: {
        type: 'object',
        properties: {
            appName: {
                type: 'string',
                description: 'The name of the application to launch',
            },
        },
        required: ['appName'],
    },
    permissionTier: 'auto',
    handler: async (params) => {
        const appName = params.appName;
        if (typeof appName !== 'string' || appName.trim().length === 0) {
            return { success: false, error: 'appName must be a non-empty string' };
        }
        const trimmed = appName.trim();
        switch (process.platform) {
            case 'win32':
                return launchWindows(trimmed);
            case 'darwin':
                return launchMac(trimmed);
            default:
                return launchLinux(trimmed);
        }
    },
});

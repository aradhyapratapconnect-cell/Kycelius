"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
const chat_handlers_1 = require("./ipc/chat.handlers");
const providers_handlers_1 = require("./ipc/providers.handlers");
const tools_handlers_1 = require("./ipc/tools.handlers");
const memory_handlers_1 = require("./ipc/memory.handlers");
const llm_handlers_1 = require("./ipc/llm.handlers");
const github_handlers_1 = require("./ipc/github.handlers");
const settings_handlers_1 = require("./ipc/settings.handlers");
const voice_handlers_1 = require("./ipc/voice.handlers");
const biometrics_handlers_1 = require("./ipc/biometrics.handlers");
const autonomous_handlers_1 = require("./ipc/autonomous.handlers");
const sync_handlers_1 = require("./ipc/sync.handlers");
const agent_handlers_1 = require("./ipc/agent.handlers");
const plugin_handlers_1 = require("./ipc/plugin.handlers");
const file_handlers_1 = require("./ipc/file.handlers");
const pluginManager_1 = require("./plugins/pluginManager");
// N-05: scheduled/triggered tasks.
const scheduler_handlers_1 = require("./ipc/scheduler.handlers");
const schedulerService_1 = require("./scheduling/schedulerService");
const supabaseSync_1 = require("./sync/supabaseSync");
const tray_1 = require("./tray");
const wakeWordService_1 = require("./voice/wakeWordService");
const db_1 = require("./db/db");
require("./tools/testTools");
require("./tools/openApp");
require("./tools/createFile");
require("./tools/sendEmail");
require("./tools/deleteFile");
require("./tools/runShellCommand");
require("./tools/github");
require("./tools/attachFile");
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    electron_1.app.quit();
}
// Compiled output is CommonJS under dist/main, so __dirname reliably points at
// dist/main in dev and in packaged builds alike.
const currentDir = __dirname;
// Resolve the compiled preload script. tsc mirrors the src/ tree under
// dist/preload (rootDir: "src"), so the file lives at
// dist/preload/preload/preload.js; fall back to a flat sibling layout for
// other packaging arrangements.
const PRELOAD_CANDIDATES = [
    (0, path_1.join)(currentDir, '../preload/preload/preload.js'),
    (0, path_1.join)(currentDir, '../preload/preload.js'),
    (0, path_1.join)(currentDir, 'preload.js'),
];
const resolvePreloadPath = () => {
    const found = PRELOAD_CANDIDATES.find(p => (0, fs_1.existsSync)(p));
    if (!found) {
        throw new Error(`Preload script not found. Tried:\n${PRELOAD_CANDIDATES.join('\n')}`);
    }
    return found;
};
// Set to true when the user explicitly quits (tray menu / OS shutdown), so the
// window close handler knows to actually let go instead of hiding to tray.
let quitting = false;
// Register IPC handlers
(0, chat_handlers_1.registerChatHandlers)();
(0, providers_handlers_1.registerProviderHandlers)();
(0, tools_handlers_1.registerToolsHandlers)();
(0, memory_handlers_1.registerMemoryHandlers)();
(0, llm_handlers_1.registerLLMHandlers)();
(0, github_handlers_1.registerGithubHandlers)();
(0, settings_handlers_1.registerSettingsHandlers)();
// F-11: Autonomous Mode config + multi-step plan runner.
(0, autonomous_handlers_1.registerAutonomousHandlers)();
// F-10: wire speaker verification before voice handlers so the transcript
// gate sees a fully configured service on the very first utterance.
(0, biometrics_handlers_1.registerBiometricsHandlers)();
(0, voice_handlers_1.registerVoiceHandlers)();
// N-01: optional Supabase cloud sync (auth + data mirror). Dormant unless
// SUPABASE_URL + SUPABASE_ANON_KEY are present at startup.
(0, sync_handlers_1.registerSyncHandlers)();
// N-02: shared/community agents (export/import + active persona).
(0, agent_handlers_1.registerAgentHandlers)();
// N-03: third-party plugins (sandboxed tool registry extensions).
(0, plugin_handlers_1.registerPluginHandlers)();
(0, file_handlers_1.registerFileHandlers)();
// N-05: scheduled/triggered tasks (view/edit/delete over IPC).
(0, scheduler_handlers_1.registerSchedulerHandlers)();
const createWindow = () => {
    // Create the browser window.
    const mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            preload: resolvePreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // Keep the ambient audio pipeline running while minimized/hidden so the
            // wake word listener works in the background.
            backgroundThrottling: false,
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        title: 'Kyclius',
        show: false,
    });
    // Load the app
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile((0, path_1.join)(currentDir, '../renderer/index.html'));
    }
    // Show window when ready to prevent visual flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });
    // Closing the window hides it to the tray instead of quitting, so wake word
    // listening survives. The tray's "Quit Kyclius" is what fully exits.
    mainWindow.on('close', event => {
        if (!quitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
};
function showMainWindow() {
    const [win] = electron_1.BrowserWindow.getAllWindows();
    if (!win) {
        createWindow();
        return;
    }
    if (win.isMinimized())
        win.restore();
    win.show();
    win.focus();
}
electron_1.app.whenReady().then(async () => {
    // N-01: restore a persisted sync session (restores CloudSyncState + session)
    // if the project env vars are configured; otherwise a no-op.
    await (0, supabaseSync_1.ensureConfiguredForApp)().catch(() => { });
    // N-03: load any active plugins into the tool registry. Per-plugin failures
    // are swallowed here; the plugin list still shows the installed-but-down ones.
    await (0, pluginManager_1.reloadAllPlugins)();
    createWindow();
    const trayCreated = (0, tray_1.createTray)({
        onOpen: showMainWindow,
        onToggleListening: voice_handlers_1.setBackgroundListening,
        onQuit: () => {
            quitting = true;
            electron_1.app.quit();
        },
    });
    // Reflect the persisted listening state on the tray at startup.
    (0, tray_1.updateTrayWakeState)(wakeWordService_1.wakeWordService.getState(), db_1.userConfig.get(voice_handlers_1.WAKE_PHRASE_KEY) ?? wakeWordService_1.DEFAULT_WAKE_PHRASE);
    if (!trayCreated && process.platform !== 'darwin') {
        // Without any tray there is no way to keep controlling a hidden app on
        // Windows/Linux — restore conventional quit-on-close behavior.
        electron_1.app.on('window-all-closed', () => {
            electron_1.app.quit();
        });
    }
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            // N-05: arm scheduled tasks after the window exists so fire notifications
            // have a window to reach.
            (0, schedulerService_1.startScheduler)();
        }
    });
});
electron_1.app.on('before-quit', () => {
    quitting = true;
});
electron_1.app.on('quit', () => {
    // Fully stop background listeners with the process.
    wakeWordService_1.wakeWordService.setEnabled(false);
    (0, tray_1.destroyTray)();
    // N-03: kill any forked plugin children.
    (0, pluginManager_1.shutdownPlugins)();
    // N-05: drop scheduler timers so nothing fires mid-shutdown.
    (0, schedulerService_1.shutdownScheduler)();
});

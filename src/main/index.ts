import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { registerChatHandlers } from './ipc/chat.handlers';
import { registerProviderHandlers } from './ipc/providers.handlers';
import { registerToolsHandlers } from './ipc/tools.handlers';
import { registerMemoryHandlers } from './ipc/memory.handlers';
import { registerLLMHandlers } from './ipc/llm.handlers';
import { registerGithubHandlers } from './ipc/github.handlers';
import { registerSettingsHandlers } from './ipc/settings.handlers';
import {
  registerVoiceHandlers,
  setBackgroundListening,
  WAKE_PHRASE_KEY,
} from './ipc/voice.handlers';
import { registerBiometricsHandlers } from './ipc/biometrics.handlers';
import { registerAutonomousHandlers } from './ipc/autonomous.handlers';
import { registerSyncHandlers } from './ipc/sync.handlers';
import { registerAgentHandlers } from './ipc/agent.handlers';
import { registerPluginHandlers } from './ipc/plugin.handlers';
import { reloadAllPlugins, shutdownPlugins } from './plugins/pluginManager';
// N-05: scheduled/triggered tasks.
import { registerSchedulerHandlers } from './ipc/scheduler.handlers';
import { startScheduler, shutdownScheduler } from './scheduling/schedulerService';
import { ensureConfiguredForApp } from './sync/supabaseSync';
import { createTray, destroyTray, updateTrayWakeState } from './tray';
import { wakeWordService, DEFAULT_WAKE_PHRASE } from './voice/wakeWordService';
import { userConfig } from './db/db';
import './tools/testTools';
import './tools/openApp';
import './tools/createFile';
import './tools/sendEmail';
import './tools/deleteFile';
import './tools/runShellCommand';
import './tools/github';
import './tools/attachFile';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Compiled output is CommonJS under dist/main, so __dirname reliably points at
// dist/main in dev and in packaged builds alike.
const currentDir = __dirname;

// Resolve the compiled preload script. tsc mirrors the src/ tree under
// dist/preload (rootDir: "src"), so the file lives at
// dist/preload/preload/preload.js; fall back to a flat sibling layout for
// other packaging arrangements.
const PRELOAD_CANDIDATES = [
  join(currentDir, '../preload/preload/preload.js'),
  join(currentDir, '../preload/preload.js'),
  join(currentDir, 'preload.js'),
];

const resolvePreloadPath = (): string => {
  const found = PRELOAD_CANDIDATES.find(p => existsSync(p));
  if (!found) {
    throw new Error(`Preload script not found. Tried:\n${PRELOAD_CANDIDATES.join('\n')}`);
  }
  return found;
};

// Set to true when the user explicitly quits (tray menu / OS shutdown), so the
// window close handler knows to actually let go instead of hiding to tray.
let quitting = false;

// Register IPC handlers
registerChatHandlers();
registerProviderHandlers();
registerToolsHandlers();
registerMemoryHandlers();
  registerLLMHandlers();
  registerGithubHandlers();
registerSettingsHandlers();
// F-11: Autonomous Mode config + multi-step plan runner.
registerAutonomousHandlers();
// F-10: wire speaker verification before voice handlers so the transcript
// gate sees a fully configured service on the very first utterance.
registerBiometricsHandlers();
registerVoiceHandlers();
// N-01: optional Supabase cloud sync (auth + data mirror). Dormant unless
// SUPABASE_URL + SUPABASE_ANON_KEY are present at startup.
registerSyncHandlers();
// N-02: shared/community agents (export/import + active persona).
registerAgentHandlers();
// N-03: third-party plugins (sandboxed tool registry extensions).
registerPluginHandlers();
// N-05: scheduled/triggered tasks (view/edit/delete over IPC).
registerSchedulerHandlers();

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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
  } else {
    mainWindow.loadFile(join(currentDir, '../renderer/index.html'));
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

function showMainWindow(): void {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.whenReady().then(async () => {
  // N-01: restore a persisted sync session (restores CloudSyncState + session)
  // if the project env vars are configured; otherwise a no-op.
  await ensureConfiguredForApp().catch(() => {});

  // N-03: load any active plugins into the tool registry. Per-plugin failures
  // are swallowed here; the plugin list still shows the installed-but-down ones.
  await reloadAllPlugins();

  createWindow();

  const trayCreated = createTray({
    onOpen: showMainWindow,
    onToggleListening: setBackgroundListening,
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });

  // Reflect the persisted listening state on the tray at startup.
  updateTrayWakeState(
    wakeWordService.getState(),
    userConfig.get(WAKE_PHRASE_KEY) ?? DEFAULT_WAKE_PHRASE
  );

  if (!trayCreated && process.platform !== 'darwin') {
    // Without any tray there is no way to keep controlling a hidden app on
    // Windows/Linux — restore conventional quit-on-close behavior.
    app.on('window-all-closed', () => {
      app.quit();
    });
  }

  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
createWindow();

  // N-05: arm scheduled tasks after the window exists so fire notifications
  // have a window to reach.
  startScheduler();
    }
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('quit', () => {
  // Fully stop background listeners with the process.
  wakeWordService.setEnabled(false);
  destroyTray();
  // N-03: kill any forked plugin children.
  shutdownPlugins();
  // N-05: drop scheduler timers so nothing fires mid-shutdown.
  shutdownScheduler();
});

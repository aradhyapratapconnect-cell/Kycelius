import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AssistantTokenPayload,
  KycliusAPI,
  ProviderAddInput,
  ProviderCapability,
  ProviderUpdatePatch,
} from '@shared/types/ipc';

// Expose the Kyclius API to the renderer process
contextBridge.exposeInMainWorld('kyclius', {
  // Command/Chat methods
  sendCommand: (text: string, inputMode?: 'voice' | 'text', turnId?: string) =>
    ipcRenderer.invoke('kyclius:send-command', text, inputMode, turnId),
  cancelCurrentTurn: () => ipcRenderer.send('kyclius:cancel-current-turn'),
  getMemory: () => ipcRenderer.invoke('kyclius:get-memory'),
  setMemoryFact: (key: string, value: string) =>
    ipcRenderer.invoke('kyclius:set-memory-fact', key, value),
  deleteMemoryFact: (id: string) => ipcRenderer.invoke('kyclius:delete-memory-fact', id),
  getToolHistory: () => ipcRenderer.invoke('kyclius:get-tool-history'),
  // Dashboard (T-17)
  getDashboardEntries: (limit?: number, offset?: number) =>
    ipcRenderer.invoke('kyclius:get-dashboard-entries', limit, offset),
  searchDashboardEntries: (query: string) =>
    ipcRenderer.invoke('kyclius:search-dashboard-entries', query),
  // Dashboard stats (T-22)
  getDashboardStats: () => ipcRenderer.invoke('kyclius:get-dashboard-stats'),

  // File methods
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  showOpenDialog: () => ipcRenderer.invoke('kyclius:show-open-dialog'),

  // Voice methods (F-07)
  startListening: () => ipcRenderer.invoke('kyclius:start-listening'),
  stopListening: () => ipcRenderer.invoke('kyclius:stop-listening'),
  speak: (text: string) => ipcRenderer.invoke('kyclius:speak', text),
  stopSpeaking: () => ipcRenderer.send('kyclius:stop-speaking'),
  getActiveSttEngine: () => ipcRenderer.invoke('kyclius:get-active-stt-engine'),
  setActiveSttEngine: (engine: SttEngineId) =>
    ipcRenderer.invoke('kyclius:set-active-stt-engine', engine),
  getWhisperModels: () => ipcRenderer.invoke('kyclius:get-whisper-models'),
  getWhisperModel: () => ipcRenderer.invoke('kyclius:get-whisper-model'),
  setWhisperModel: (id: WhisperModelId) =>
    ipcRenderer.invoke('kyclius:set-whisper-model', id),
  downloadWhisperModel: (id: WhisperModelId) =>
    ipcRenderer.invoke('kyclius:download-whisper-model', id),
  onWhisperModelProgress: (callback: (progress: WhisperDownloadProgress) => void) => {
    const handler = (_: Electron.IpcRendererEvent, progress: WhisperDownloadProgress) =>
      callback(progress);
    ipcRenderer.on('kyclius:whisper-model-progress', handler);
    return () => ipcRenderer.off('kyclius:whisper-model-progress', handler);
  },
  sendAudioChunk: (data: ArrayBuffer) => ipcRenderer.send('kyclius:voice-audio-chunk', data),
  sendWakeAudioChunk: (data: ArrayBuffer) => ipcRenderer.send('kyclius:wake-audio-chunk', data),
  notifyVoiceCaptureStarted: () => ipcRenderer.send('kyclius:voice-capture-started'),
  notifyWakeCaptureStarted: () => ipcRenderer.send('kyclius:wake-capture-started'),
  notifyVoiceCaptureFailed: (error: VoiceError) =>
    ipcRenderer.send('kyclius:voice-capture-failed', error),
  submitSystemTranscript: (text: string, isFinal: boolean) =>
    ipcRenderer.send('kyclius:voice-system-transcript', text, isFinal),

  // Settings methods
  getSettings: () => ipcRenderer.invoke('kyclius:get-settings'),
  updateSettings: (settings: Partial<UserSettings>) =>
    ipcRenderer.invoke('kyclius:update-settings', settings),
  openExternalUrl: (url: string) => ipcRenderer.invoke('kyclius:open-external-url', url),

  // S-01: first-run onboarding state
  getOnboardingComplete: () => ipcRenderer.invoke('kyclius:get-onboarding-complete'),
  setOnboardingComplete: () => ipcRenderer.invoke('kyclius:set-onboarding-complete'),

  // N-01: optional Supabase cloud sync
  getSyncStatus: () => ipcRenderer.invoke('kyclius:get-sync-status'),
  signIn: (email: string) => ipcRenderer.invoke('kyclius:sign-in', email),
  awaitSignInCompletion: () => ipcRenderer.invoke('kyclius:await-sign-in-complete'),
  signOut: () => ipcRenderer.invoke('kyclius:sign-out'),
  setSyncEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('kyclius:set-sync-enabled', enabled),
  syncNow: () => ipcRenderer.invoke('kyclius:sync-now'),
  getSyncConflicts: () => ipcRenderer.invoke('kyclius:get-sync-conflicts'),

  // N-02: shared/community agents
  listInstalledAgents: () => ipcRenderer.invoke('kyclius:list-installed-agents'),
  getActiveAgent: () => ipcRenderer.invoke('kyclius:get-active-agent'),
  selectActiveAgent: (id: string | null) =>
    ipcRenderer.invoke('kyclius:select-active-agent', id),
  removeAgent: (id: string) => ipcRenderer.invoke('kyclius:remove-agent', id),
  previewAgentBundle: () => ipcRenderer.invoke('kyclius:preview-agent-bundle'),
  confirmImportAgent: (payload) =>
    ipcRenderer.invoke('kyclius:confirm-import-agent', payload),
  exportAgent: (id: string) => ipcRenderer.invoke('kyclius:export-agent', id),

  // N-03: third-party plugins
  listPlugins: () => ipcRenderer.invoke('kyclius:list-plugins'),
  previewInstallPlugin: () => ipcRenderer.invoke('kyclius:preview-install-plugin'),
  confirmInstallPlugin: (payload) =>
    ipcRenderer.invoke('kyclius:confirm-install-plugin', payload),
  uninstallPlugin: (id: string) => ipcRenderer.invoke('kyclius:uninstall-plugin', id),
  setPluginActive: (id: string, active: boolean) =>
    ipcRenderer.invoke('kyclius:set-plugin-active', id, active),

  // Autonomous Mode
  getAutonomousModeConfig: () => ipcRenderer.invoke('kyclius:get-autonomous-config'),
  updateAutonomousModeConfig: (config: Partial<AutonomousModeConfig>) =>
    ipcRenderer.invoke('kyclius:update-autonomous-config', config),
  onAutonomousModeChanged: (callback: (config: AutonomousModeConfig) => void) => {
    const handler = (_: Electron.IpcRendererEvent, config: AutonomousModeConfig) => callback(config);
    ipcRenderer.on('kyclius:autonomous-mode-changed', handler);
    return () => ipcRenderer.off('kyclius:autonomous-mode-changed', handler);
  },

  // Voice biometrics (F-10)
  enrollVoice: (audioSamples: ArrayBuffer[]) =>
    ipcRenderer.invoke('kyclius:enroll-voice', audioSamples),
  removeVoiceEnrollment: () => ipcRenderer.invoke('kyclius:remove-voice-enrollment'),
  getBiometricsStatus: () => ipcRenderer.invoke('kyclius:get-biometrics-status'),
  setBiometricsEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('kyclius:set-biometrics-enabled', enabled),

  // Wake word
  getWakeWordConfig: () => ipcRenderer.invoke('kyclius:get-wake-word-config'),
  setWakeWord: (phrase: string) => ipcRenderer.invoke('kyclius:set-wake-word', phrase),
  toggleBackgroundListening: (enabled: boolean) =>
    ipcRenderer.invoke('kyclius:toggle-background-listening', enabled),

  // LLM Provider methods (F-04)
  getLLMProvider: () => ipcRenderer.invoke('kyclius:get-llm-provider'),
  setLLMProvider: (provider: string) => ipcRenderer.invoke('kyclius:set-llm-provider', provider),
  validateLLMKey: (provider: string, apiKey: string) =>
    ipcRenderer.invoke('kyclius:validate-llm-key', provider, apiKey),
  setLLMApiKey: (provider: string, apiKey: string) =>
    ipcRenderer.invoke('kyclius:set-llm-api-key', provider, apiKey),
  hasLLMApiKey: (provider: string) => ipcRenderer.invoke('kyclius:has-llm-api-key', provider),
  getLLMModel: (provider: string) => ipcRenderer.invoke('kyclius:get-llm-model', provider),
  setLLMModel: (provider: string, model: string) =>
    ipcRenderer.invoke('kyclius:set-llm-model', provider, model),

  // N-07: open provider registry
  listProviders: (capability?: ProviderCapability) =>
    ipcRenderer.invoke('kyclius:list-providers', capability),
  listProviderPresets: (capability?: ProviderCapability) =>
    ipcRenderer.invoke('kyclius:list-provider-presets', capability),
  addProvider: (input: ProviderAddInput) => ipcRenderer.invoke('kyclius:add-provider', input),
  updateProvider: (id: string, patch: ProviderUpdatePatch) =>
    ipcRenderer.invoke('kyclius:update-provider', id, patch),
  removeProvider: (id: string) => ipcRenderer.invoke('kyclius:remove-provider', id),
  deleteProviderApiKey: (id: string) =>
    ipcRenderer.invoke('kyclius:delete-provider-api-key', id),
  listProviderModels: (id: string) => ipcRenderer.invoke('kyclius:list-provider-models', id),
  getActiveProvider: (capability) =>
    ipcRenderer.invoke('kyclius:get-active-provider', capability),
  setActiveProvider: (capability, id: string) =>
    ipcRenderer.invoke('kyclius:set-active-provider', capability, id),
  setProviderApiKey: (id: string, apiKey: string) =>
    ipcRenderer.invoke('kyclius:set-provider-api-key', id, apiKey),

  // T-26: per-turn token streaming
  onAssistantToken: (callback: (payload: AssistantTokenPayload) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: AssistantTokenPayload) =>
      callback(payload);
    ipcRenderer.on('kyclius:assistant-token', handler);
    return () => ipcRenderer.off('kyclius:assistant-token', handler);
  },

  // N-04: rule-based multi-LLM routing
  getLlmRoutingConfig: () => ipcRenderer.invoke('kyclius:get-llm-routing-config'),
  setLlmRoutingConfig: (config) =>
    ipcRenderer.invoke('kyclius:set-llm-routing-config', config),

  // N-05: scheduled/recurring commands
  listScheduledTasks: () => ipcRenderer.invoke('kyclius:list-scheduled-tasks'),
  createScheduledTask: (input) => ipcRenderer.invoke('kyclius:create-scheduled-task', input),
  updateScheduledTask: (id, patch) =>
    ipcRenderer.invoke('kyclius:update-scheduled-task', id, patch),
  deleteScheduledTask: (id) => ipcRenderer.invoke('kyclius:delete-scheduled-task', id),
  onScheduledTasksChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('kyclius:scheduled-tasks-changed', handler);
    return () => ipcRenderer.off('kyclius:scheduled-tasks-changed', handler);
  },

  // GitHub integration (T-10)
  setGithubToken: (token: string) => ipcRenderer.invoke('kyclius:set-github-token', token),
  hasGithubToken: () => ipcRenderer.invoke('kyclius:has-github-token'),
  removeGithubToken: () => ipcRenderer.invoke('kyclius:remove-github-token'),

  // Tool methods (F-05)
  getAvailableTools: () => ipcRenderer.invoke('kyclius:get-available-tools'),
  executeTool: (toolCall: ToolCall) => ipcRenderer.invoke('kyclius:execute-tool', toolCall),

  // Permission confirmations (F-06)
  respondToConfirmation: (response: ConfirmationResponse) =>
    ipcRenderer.invoke('kyclius:respond-to-confirmation', response),

  // Event listeners
  onTranscript: (callback: (text: string, isFinal: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, text: string, isFinal: boolean) =>
      callback(text, isFinal);
    ipcRenderer.on('kyclius:transcript', handler);
    return () => ipcRenderer.off('kyclius:transcript', handler);
  },
  onAssistantStateChange: (callback: (state: AssistantState) => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: AssistantState) => callback(state);
    ipcRenderer.on('kyclius:assistant-state-change', handler);
    return () => ipcRenderer.off('kyclius:assistant-state-change', handler);
  },
  onConfirmationRequired: (callback: (confirmation: PendingConfirmation) => void) => {
    const handler = (_: Electron.IpcRendererEvent, confirmation: PendingConfirmation) =>
      callback(confirmation);
    ipcRenderer.on('kyclius:confirmation-required', handler);
    return () => ipcRenderer.off('kyclius:confirmation-required', handler);
  },
  onToolExecutionUpdate: (callback: (update: ToolExecutionUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, update: ToolExecutionUpdate) => callback(update);
    ipcRenderer.on('kyclius:tool-execution-update', handler);
    return () => ipcRenderer.off('kyclius:tool-execution-update', handler);
  },
  onVoiceError: (callback: (error: VoiceError) => void) => {
    const handler = (_: Electron.IpcRendererEvent, error: VoiceError) => callback(error);
    ipcRenderer.on('kyclius:voice-error', handler);
    return () => ipcRenderer.off('kyclius:voice-error', handler);
  },
  onVoiceEngineNotice: (callback: (notice: { message: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, notice: { message: string }) =>
      callback(notice);
    ipcRenderer.on('kyclius:voice-engine-notice', handler);
    return () => ipcRenderer.off('kyclius:voice-engine-notice', handler);
  },
  onVoiceStartCapture: (callback: (options: { engine: SttEngineId }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, options: { engine: SttEngineId }) =>
      callback(options);
    ipcRenderer.on('kyclius:voice:start-capture', handler);
    return () => ipcRenderer.off('kyclius:voice:start-capture', handler);
  },
  onVoiceStopCapture: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('kyclius:voice:stop-capture', handler);
    return () => ipcRenderer.off('kyclius:voice:stop-capture', handler);
  },
  onWakeStartAmbientCapture: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('kyclius:wake:start-ambient-capture', handler);
    return () => ipcRenderer.off('kyclius:wake:start-ambient-capture', handler);
  },
  onWakeStopAmbientCapture: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('kyclius:wake:stop-ambient-capture', handler);
    return () => ipcRenderer.off('kyclius:wake:stop-ambient-capture', handler);
  },
  onWakeStateChanged: (callback: (state: WakeListeningState) => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: WakeListeningState) => callback(state);
    ipcRenderer.on('kyclius:wake-state-changed', handler);
    return () => ipcRenderer.off('kyclius:wake-state-changed', handler);
  },
  onWakeDetected: (callback: (transcript: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, transcript: string) => callback(transcript);
    ipcRenderer.on('kyclius:wake-detected', handler);
    return () => ipcRenderer.off('kyclius:wake-detected', handler);
  },
  onWakeError: (callback: (error: VoiceError) => void) => {
    const handler = (_: Electron.IpcRendererEvent, error: VoiceError) => callback(error);
    ipcRenderer.on('kyclius:wake-error', handler);
    return () => ipcRenderer.off('kyclius:wake-error', handler);
  },
} satisfies KycliusAPI);

// Re-export types for the renderer to use
import type {
  UserSettings,
  AutonomousModeConfig,
  AssistantState,
  PendingConfirmation,
  ConfirmationResponse,
  ToolExecutionUpdate,
  ToolCall,
  SttEngineId,
  WhisperModelId,
  WhisperDownloadProgress,
  VoiceError,
  WakeListeningState,
} from '@shared/types/ipc';

// Type declaration for the exposed API
declare global {
  interface Window {
    kyclius: KycliusAPI;
  }
}

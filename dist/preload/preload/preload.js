"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose the Kyclius API to the renderer process
electron_1.contextBridge.exposeInMainWorld('kyclius', {
    // Command/Chat methods
    sendCommand: (text, inputMode, turnId) => electron_1.ipcRenderer.invoke('kyclius:send-command', text, inputMode, turnId),
    cancelCurrentTurn: () => electron_1.ipcRenderer.send('kyclius:cancel-current-turn'),
    getMemory: () => electron_1.ipcRenderer.invoke('kyclius:get-memory'),
    setMemoryFact: (key, value) => electron_1.ipcRenderer.invoke('kyclius:set-memory-fact', key, value),
    deleteMemoryFact: (id) => electron_1.ipcRenderer.invoke('kyclius:delete-memory-fact', id),
    getToolHistory: () => electron_1.ipcRenderer.invoke('kyclius:get-tool-history'),
    // Dashboard (T-17)
    getDashboardEntries: (limit, offset) => electron_1.ipcRenderer.invoke('kyclius:get-dashboard-entries', limit, offset),
    searchDashboardEntries: (query) => electron_1.ipcRenderer.invoke('kyclius:search-dashboard-entries', query),
    // Dashboard stats (T-22)
    getDashboardStats: () => electron_1.ipcRenderer.invoke('kyclius:get-dashboard-stats'),
    // File methods
    getPathForFile: (file) => electron_1.webUtils.getPathForFile(file),
    showOpenDialog: () => electron_1.ipcRenderer.invoke('kyclius:show-open-dialog'),
    // Voice methods (F-07)
    startListening: () => electron_1.ipcRenderer.invoke('kyclius:start-listening'),
    stopListening: () => electron_1.ipcRenderer.invoke('kyclius:stop-listening'),
    speak: (text) => electron_1.ipcRenderer.invoke('kyclius:speak', text),
    stopSpeaking: () => electron_1.ipcRenderer.send('kyclius:stop-speaking'),
    getActiveSttEngine: () => electron_1.ipcRenderer.invoke('kyclius:get-active-stt-engine'),
    setActiveSttEngine: (engine) => electron_1.ipcRenderer.invoke('kyclius:set-active-stt-engine', engine),
    getWhisperModels: () => electron_1.ipcRenderer.invoke('kyclius:get-whisper-models'),
    getWhisperModel: () => electron_1.ipcRenderer.invoke('kyclius:get-whisper-model'),
    setWhisperModel: (id) => electron_1.ipcRenderer.invoke('kyclius:set-whisper-model', id),
    downloadWhisperModel: (id) => electron_1.ipcRenderer.invoke('kyclius:download-whisper-model', id),
    onWhisperModelProgress: (callback) => {
        const handler = (_, progress) => callback(progress);
        electron_1.ipcRenderer.on('kyclius:whisper-model-progress', handler);
        return () => electron_1.ipcRenderer.off('kyclius:whisper-model-progress', handler);
    },
    sendAudioChunk: (data) => electron_1.ipcRenderer.send('kyclius:voice-audio-chunk', data),
    sendWakeAudioChunk: (data) => electron_1.ipcRenderer.send('kyclius:wake-audio-chunk', data),
    notifyVoiceCaptureStarted: () => electron_1.ipcRenderer.send('kyclius:voice-capture-started'),
    notifyWakeCaptureStarted: () => electron_1.ipcRenderer.send('kyclius:wake-capture-started'),
    notifyVoiceCaptureFailed: (error) => electron_1.ipcRenderer.send('kyclius:voice-capture-failed', error),
    submitSystemTranscript: (text, isFinal) => electron_1.ipcRenderer.send('kyclius:voice-system-transcript', text, isFinal),
    // Settings methods
    getSettings: () => electron_1.ipcRenderer.invoke('kyclius:get-settings'),
    updateSettings: (settings) => electron_1.ipcRenderer.invoke('kyclius:update-settings', settings),
    openExternalUrl: (url) => electron_1.ipcRenderer.invoke('kyclius:open-external-url', url),
    // S-01: first-run onboarding state
    getOnboardingComplete: () => electron_1.ipcRenderer.invoke('kyclius:get-onboarding-complete'),
    setOnboardingComplete: () => electron_1.ipcRenderer.invoke('kyclius:set-onboarding-complete'),
    // N-01: optional Supabase cloud sync
    getSyncStatus: () => electron_1.ipcRenderer.invoke('kyclius:get-sync-status'),
    signIn: (email) => electron_1.ipcRenderer.invoke('kyclius:sign-in', email),
    awaitSignInCompletion: () => electron_1.ipcRenderer.invoke('kyclius:await-sign-in-complete'),
    signOut: () => electron_1.ipcRenderer.invoke('kyclius:sign-out'),
    setSyncEnabled: (enabled) => electron_1.ipcRenderer.invoke('kyclius:set-sync-enabled', enabled),
    syncNow: () => electron_1.ipcRenderer.invoke('kyclius:sync-now'),
    getSyncConflicts: () => electron_1.ipcRenderer.invoke('kyclius:get-sync-conflicts'),
    // N-02: shared/community agents
    listInstalledAgents: () => electron_1.ipcRenderer.invoke('kyclius:list-installed-agents'),
    getActiveAgent: () => electron_1.ipcRenderer.invoke('kyclius:get-active-agent'),
    selectActiveAgent: (id) => electron_1.ipcRenderer.invoke('kyclius:select-active-agent', id),
    removeAgent: (id) => electron_1.ipcRenderer.invoke('kyclius:remove-agent', id),
    previewAgentBundle: () => electron_1.ipcRenderer.invoke('kyclius:preview-agent-bundle'),
    confirmImportAgent: (payload) => electron_1.ipcRenderer.invoke('kyclius:confirm-import-agent', payload),
    exportAgent: (id) => electron_1.ipcRenderer.invoke('kyclius:export-agent', id),
    // N-03: third-party plugins
    listPlugins: () => electron_1.ipcRenderer.invoke('kyclius:list-plugins'),
    previewInstallPlugin: () => electron_1.ipcRenderer.invoke('kyclius:preview-install-plugin'),
    confirmInstallPlugin: (payload) => electron_1.ipcRenderer.invoke('kyclius:confirm-install-plugin', payload),
    uninstallPlugin: (id) => electron_1.ipcRenderer.invoke('kyclius:uninstall-plugin', id),
    setPluginActive: (id, active) => electron_1.ipcRenderer.invoke('kyclius:set-plugin-active', id, active),
    // Autonomous Mode
    getAutonomousModeConfig: () => electron_1.ipcRenderer.invoke('kyclius:get-autonomous-config'),
    updateAutonomousModeConfig: (config) => electron_1.ipcRenderer.invoke('kyclius:update-autonomous-config', config),
    onAutonomousModeChanged: (callback) => {
        const handler = (_, config) => callback(config);
        electron_1.ipcRenderer.on('kyclius:autonomous-mode-changed', handler);
        return () => electron_1.ipcRenderer.off('kyclius:autonomous-mode-changed', handler);
    },
    // Voice biometrics (F-10)
    enrollVoice: (audioSamples) => electron_1.ipcRenderer.invoke('kyclius:enroll-voice', audioSamples),
    removeVoiceEnrollment: () => electron_1.ipcRenderer.invoke('kyclius:remove-voice-enrollment'),
    getBiometricsStatus: () => electron_1.ipcRenderer.invoke('kyclius:get-biometrics-status'),
    setBiometricsEnabled: (enabled) => electron_1.ipcRenderer.invoke('kyclius:set-biometrics-enabled', enabled),
    // Wake word
    getWakeWordConfig: () => electron_1.ipcRenderer.invoke('kyclius:get-wake-word-config'),
    setWakeWord: (phrase) => electron_1.ipcRenderer.invoke('kyclius:set-wake-word', phrase),
    toggleBackgroundListening: (enabled) => electron_1.ipcRenderer.invoke('kyclius:toggle-background-listening', enabled),
    // LLM Provider methods (F-04)
    getLLMProvider: () => electron_1.ipcRenderer.invoke('kyclius:get-llm-provider'),
    setLLMProvider: (provider) => electron_1.ipcRenderer.invoke('kyclius:set-llm-provider', provider),
    validateLLMKey: (provider, apiKey) => electron_1.ipcRenderer.invoke('kyclius:validate-llm-key', provider, apiKey),
    setLLMApiKey: (provider, apiKey) => electron_1.ipcRenderer.invoke('kyclius:set-llm-api-key', provider, apiKey),
    hasLLMApiKey: (provider) => electron_1.ipcRenderer.invoke('kyclius:has-llm-api-key', provider),
    getLLMModel: (provider) => electron_1.ipcRenderer.invoke('kyclius:get-llm-model', provider),
    setLLMModel: (provider, model) => electron_1.ipcRenderer.invoke('kyclius:set-llm-model', provider, model),
    // N-07: open provider registry
    listProviders: (capability) => electron_1.ipcRenderer.invoke('kyclius:list-providers', capability),
    listProviderPresets: (capability) => electron_1.ipcRenderer.invoke('kyclius:list-provider-presets', capability),
    addProvider: (input) => electron_1.ipcRenderer.invoke('kyclius:add-provider', input),
    updateProvider: (id, patch) => electron_1.ipcRenderer.invoke('kyclius:update-provider', id, patch),
    removeProvider: (id) => electron_1.ipcRenderer.invoke('kyclius:remove-provider', id),
    deleteProviderApiKey: (id) => electron_1.ipcRenderer.invoke('kyclius:delete-provider-api-key', id),
    listProviderModels: (id) => electron_1.ipcRenderer.invoke('kyclius:list-provider-models', id),
    getActiveProvider: (capability) => electron_1.ipcRenderer.invoke('kyclius:get-active-provider', capability),
    setActiveProvider: (capability, id) => electron_1.ipcRenderer.invoke('kyclius:set-active-provider', capability, id),
    setProviderApiKey: (id, apiKey) => electron_1.ipcRenderer.invoke('kyclius:set-provider-api-key', id, apiKey),
    // T-26: per-turn token streaming
    onAssistantToken: (callback) => {
        const handler = (_, payload) => callback(payload);
        electron_1.ipcRenderer.on('kyclius:assistant-token', handler);
        return () => electron_1.ipcRenderer.off('kyclius:assistant-token', handler);
    },
    // N-04: rule-based multi-LLM routing
    getLlmRoutingConfig: () => electron_1.ipcRenderer.invoke('kyclius:get-llm-routing-config'),
    setLlmRoutingConfig: (config) => electron_1.ipcRenderer.invoke('kyclius:set-llm-routing-config', config),
    // N-05: scheduled/recurring commands
    listScheduledTasks: () => electron_1.ipcRenderer.invoke('kyclius:list-scheduled-tasks'),
    createScheduledTask: (input) => electron_1.ipcRenderer.invoke('kyclius:create-scheduled-task', input),
    updateScheduledTask: (id, patch) => electron_1.ipcRenderer.invoke('kyclius:update-scheduled-task', id, patch),
    deleteScheduledTask: (id) => electron_1.ipcRenderer.invoke('kyclius:delete-scheduled-task', id),
    onScheduledTasksChanged: (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on('kyclius:scheduled-tasks-changed', handler);
        return () => electron_1.ipcRenderer.off('kyclius:scheduled-tasks-changed', handler);
    },
    // GitHub integration (T-10)
    setGithubToken: (token) => electron_1.ipcRenderer.invoke('kyclius:set-github-token', token),
    hasGithubToken: () => electron_1.ipcRenderer.invoke('kyclius:has-github-token'),
    removeGithubToken: () => electron_1.ipcRenderer.invoke('kyclius:remove-github-token'),
    // Tool methods (F-05)
    getAvailableTools: () => electron_1.ipcRenderer.invoke('kyclius:get-available-tools'),
    executeTool: (toolCall) => electron_1.ipcRenderer.invoke('kyclius:execute-tool', toolCall),
    // Permission confirmations (F-06)
    respondToConfirmation: (response) => electron_1.ipcRenderer.invoke('kyclius:respond-to-confirmation', response),
    // Event listeners
    onTranscript: (callback) => {
        const handler = (_, text, isFinal) => callback(text, isFinal);
        electron_1.ipcRenderer.on('kyclius:transcript', handler);
        return () => electron_1.ipcRenderer.off('kyclius:transcript', handler);
    },
    onAssistantStateChange: (callback) => {
        const handler = (_, state) => callback(state);
        electron_1.ipcRenderer.on('kyclius:assistant-state-change', handler);
        return () => electron_1.ipcRenderer.off('kyclius:assistant-state-change', handler);
    },
    onConfirmationRequired: (callback) => {
        const handler = (_, confirmation) => callback(confirmation);
        electron_1.ipcRenderer.on('kyclius:confirmation-required', handler);
        return () => electron_1.ipcRenderer.off('kyclius:confirmation-required', handler);
    },
    onToolExecutionUpdate: (callback) => {
        const handler = (_, update) => callback(update);
        electron_1.ipcRenderer.on('kyclius:tool-execution-update', handler);
        return () => electron_1.ipcRenderer.off('kyclius:tool-execution-update', handler);
    },
    onVoiceError: (callback) => {
        const handler = (_, error) => callback(error);
        electron_1.ipcRenderer.on('kyclius:voice-error', handler);
        return () => electron_1.ipcRenderer.off('kyclius:voice-error', handler);
    },
    onVoiceEngineNotice: (callback) => {
        const handler = (_, notice) => callback(notice);
        electron_1.ipcRenderer.on('kyclius:voice-engine-notice', handler);
        return () => electron_1.ipcRenderer.off('kyclius:voice-engine-notice', handler);
    },
    onVoiceStartCapture: (callback) => {
        const handler = (_, options) => callback(options);
        electron_1.ipcRenderer.on('kyclius:voice:start-capture', handler);
        return () => electron_1.ipcRenderer.off('kyclius:voice:start-capture', handler);
    },
    onVoiceStopCapture: (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on('kyclius:voice:stop-capture', handler);
        return () => electron_1.ipcRenderer.off('kyclius:voice:stop-capture', handler);
    },
    onWakeStartAmbientCapture: (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on('kyclius:wake:start-ambient-capture', handler);
        return () => electron_1.ipcRenderer.off('kyclius:wake:start-ambient-capture', handler);
    },
    onWakeStopAmbientCapture: (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on('kyclius:wake:stop-ambient-capture', handler);
        return () => electron_1.ipcRenderer.off('kyclius:wake:stop-ambient-capture', handler);
    },
    onWakeStateChanged: (callback) => {
        const handler = (_, state) => callback(state);
        electron_1.ipcRenderer.on('kyclius:wake-state-changed', handler);
        return () => electron_1.ipcRenderer.off('kyclius:wake-state-changed', handler);
    },
    onWakeDetected: (callback) => {
        const handler = (_, transcript) => callback(transcript);
        electron_1.ipcRenderer.on('kyclius:wake-detected', handler);
        return () => electron_1.ipcRenderer.off('kyclius:wake-detected', handler);
    },
    onWakeError: (callback) => {
        const handler = (_, error) => callback(error);
        electron_1.ipcRenderer.on('kyclius:wake-error', handler);
        return () => electron_1.ipcRenderer.off('kyclius:wake-error', handler);
    },
});

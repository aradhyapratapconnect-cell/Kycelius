
/**
 * Shared TypeScript types for the IPC bridge between renderer and main process.
 * These types are used by both the preload script and the renderer.
 */

export interface KycliusAPI {
  sendCommand: (
    text: string,
    inputMode?: 'voice' | 'text',
    turnId?: string
  ) => Promise<SendCommandResult>;
  /** Aborts the in-flight send-command turn (T-02 "Stop generating"). */
  cancelCurrentTurn: () => void;
  getMemory: () => Promise<MemoryFact[]>;
  setMemoryFact: (key: string, value: string) => Promise<MemoryMutationResult>;
  deleteMemoryFact: (id: string) => Promise<MemoryMutationResult>;
  getToolHistory: () => Promise<ToolExecution[]>;
  // Dashboard (T-17)
  getDashboardEntries: (limit?: number, offset?: number) => Promise<DashboardEntry[]>;
  searchDashboardEntries: (query: string) => Promise<DashboardEntry[]>;
  // Dashboard stats (T-22) — real counts from the local tables
  getDashboardStats: () => Promise<DashboardStats>;
  // File methods
  getPathForFile: (file: File) => string;
  showOpenDialog: () => Promise<string[] | undefined>;
  // Voice methods (F-07)
  startListening: () => Promise<VoiceStartResult>;
  stopListening: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  getActiveSttEngine: () => Promise<SttEngineId>;
  setActiveSttEngine: (engine: SttEngineId) => Promise<void>;
  // F-07: whisper model catalogue + download (STT quality ladder)
  getWhisperModels: () => Promise<WhisperModelStatus[]>;
  getWhisperModel: () => Promise<WhisperModelId | undefined>;
  setWhisperModel: (id: WhisperModelId) => Promise<void>;
  downloadWhisperModel: (id: WhisperModelId) => Promise<WhisperDownloadResult>;
  onWhisperModelProgress: (callback: (progress: WhisperDownloadProgress) => void) => () => void;
  sendAudioChunk: (data: ArrayBuffer) => void;
  sendWakeAudioChunk: (data: ArrayBuffer) => void;
  notifyVoiceCaptureStarted: () => void;
  notifyWakeCaptureStarted: () => void;
  notifyVoiceCaptureFailed: (error: VoiceError) => void;
  submitSystemTranscript: (text: string, isFinal: boolean) => void;
  // Settings methods
  getSettings: () => Promise<UserSettings>;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  // S-01: first-run onboarding state
  getOnboardingComplete: () => Promise<boolean>;
  setOnboardingComplete: () => Promise<void>;
  // N-01: optional Supabase cloud sync
  getSyncStatus: () => Promise<SyncStatus>;
  signIn: (email: string) => Promise<void>;
  awaitSignInCompletion: () => Promise<{ email: string }>;
  signOut: () => Promise<void>;
  setSyncEnabled: (enabled: boolean) => Promise<SyncStatus>;
  syncNow: () => Promise<SyncRunResult>;
  getSyncConflicts: () => Promise<SyncConflict[]>;
  // N-02: shared/community agents
  listInstalledAgents: () => Promise<InstalledAgentInfo[]>;
  getActiveAgent: () => Promise<InstalledAgentInfo | null>;
  selectActiveAgent: (id: string | null) => Promise<string | null>;
  removeAgent: (id: string) => Promise<void>;
  previewAgentBundle: () => Promise<AgentImportResult>;
  confirmImportAgent: (payload: AgentImportConfirmPayload) => Promise<{ installed: boolean; agentId: string }>;
  exportAgent: (id: string) => Promise<{ canceled: boolean; path?: string }>;
  // N-03: third-party plugins
  listPlugins: () => Promise<InstalledPluginInfo[]>;
  previewInstallPlugin: () => Promise<PluginInstallResult>;
  confirmInstallPlugin: (payload: PluginInstallConfirmPayload) => Promise<{ installed: boolean; pluginId: string }>;
  uninstallPlugin: (id: string) => Promise<{ removed: boolean }>;
  setPluginActive: (id: string, active: boolean) => Promise<void>;
  // Autonomous Mode
  getAutonomousModeConfig: () => Promise<AutonomousModeConfig>;
  updateAutonomousModeConfig: (config: Partial<AutonomousModeConfig>) => Promise<void>;
  onAutonomousModeChanged: (callback: (config: AutonomousModeConfig) => void) => () => void;
  // Voice biometrics (F-10)
  enrollVoice: (audioSamples: ArrayBuffer[]) => Promise<VoiceEnrollResult>;
  removeVoiceEnrollment: () => Promise<{ ok: boolean }>;
  getBiometricsStatus: () => Promise<BiometricsStatus>;
  setBiometricsEnabled: (enabled: boolean) => Promise<void>;
  // Wake word
  getWakeWordConfig: () => Promise<WakeWordConfig>;
  setWakeWord: (phrase: string) => Promise<WakePhraseValidation>;
  toggleBackgroundListening: (enabled: boolean) => Promise<void>;
  // LLM Provider methods (F-04)
  getLLMProvider: () => Promise<string>;
  setLLMProvider: (provider: string) => Promise<void>;
  validateLLMKey: (provider: string, apiKey: string) => Promise<boolean>;
  setLLMApiKey: (provider: string, apiKey: string) => Promise<void>;
  hasLLMApiKey: (provider: string) => Promise<boolean>;
  getLLMModel: (provider: string) => Promise<string>;
  setLLMModel: (provider: string, model: string) => Promise<void>;
  // N-07: open provider registry (rows = data, incl. custom OpenAI-compatible)
  listProviders: (capability?: ProviderCapability) => Promise<ProviderInfo[]>;
  listProviderPresets: (capability?: ProviderCapability) => Promise<ProviderPresetInfo[]>;
  addProvider: (input: ProviderAddInput) => Promise<ProviderInfo>;
  updateProvider: (id: string, patch: ProviderUpdatePatch) => Promise<ProviderInfo>;
  removeProvider: (id: string) => Promise<{ removed: boolean }>;
  deleteProviderApiKey: (id: string) => Promise<void>;
  listProviderModels: (id: string) => Promise<string[]>;
  // N-08: active default per capability (llm | stt | tts) + write-only key save
  getActiveProvider: (capability: ProviderCapability) => Promise<string>;
  setActiveProvider: (capability: ProviderCapability, id: string) => Promise<void>;
  setProviderApiKey: (id: string, apiKey: string) => Promise<void>;
  // T-26: per-turn token streaming
  onAssistantToken: (callback: (payload: AssistantTokenPayload) => void) => () => void;
  // N-04: rule-based multi-LLM routing
  getLlmRoutingConfig: () => Promise<LlmRoutingConfig>;
  setLlmRoutingConfig: (
    config: { enabled?: boolean; rules?: LlmRoutingRule[] }
  ) => Promise<LlmRoutingConfig>;
  // N-05: scheduled/recurring commands
  listScheduledTasks: () => Promise<ScheduledTaskInfo[]>;
  createScheduledTask: (input: ScheduledTaskInput) => Promise<ScheduledTaskInfo>;
  updateScheduledTask: (
    id: string,
    patch: Partial<ScheduledTaskInput>
  ) => Promise<ScheduledTaskInfo>;
  deleteScheduledTask: (id: string) => Promise<{ removed: boolean }>;
  onScheduledTasksChanged: (callback: () => void) => () => void;
  // GitHub integration (T-10)
  setGithubToken: (token: string) => Promise<void>;
  hasGithubToken: () => Promise<boolean>;
  removeGithubToken: () => Promise<void>;
  // Tool methods (F-05)
  getAvailableTools: () => Promise<ToolSchema[]>;
  executeTool: (toolCall: ToolCall) => Promise<ToolExecutionResult>;
  // Permission confirmations (F-06)
  respondToConfirmation: (response: ConfirmationResponse) => Promise<boolean>;
  // Event listeners
  onTranscript: (callback: (text: string, isFinal: boolean) => void) => () => void;
  onAssistantStateChange: (callback: (state: AssistantState) => void) => () => void;
  onConfirmationRequired: (callback: (confirmation: PendingConfirmation) => void) => () => void;
  onToolExecutionUpdate: (callback: (update: ToolExecutionUpdate) => void) => () => void;
  onVoiceError: (callback: (error: VoiceError) => void) => () => void;
  onVoiceEngineNotice: (callback: (notice: { message: string }) => void) => () => void;
  onVoiceStartCapture: (callback: (options: { engine: SttEngineId }) => void) => () => void;
  onVoiceStopCapture: (callback: () => void) => () => void;
  onWakeStartAmbientCapture: (callback: () => void) => () => void;
  onWakeStopAmbientCapture: (callback: () => void) => () => void;
  onWakeStateChanged: (callback: (state: WakeListeningState) => void) => () => void;
  onWakeDetected: (callback: (transcript: string) => void) => () => void;
  onWakeError: (callback: (error: VoiceError) => void) => () => void;
}

// N-07: provider registry rows exposed to the renderer. NEVER contains keys.
export type ProviderCapability = 'llm' | 'stt' | 'tts';

export type ProviderSchema =
  | 'openai_compatible'
  | 'anthropic_native'
  | 'gemini_native'
  | 'cloud_stt'
  | 'cloud_tts';

export interface ProviderInfo {
  id: string;
  capability: ProviderCapability;
  presetKey: string;
  displayName: string;
  schema: ProviderSchema;
  baseUrl?: string | null;
  defaultModel?: string | null;
  enabled: boolean;
  isDefault: boolean;
  hasKey: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProviderPresetInfo {
  presetKey: string;
  displayName: string;
  capability: ProviderCapability;
  schema: ProviderSchema;
  baseUrl?: string;
  defaultModel: string;
}

export interface ProviderAddInput {
  capability: ProviderCapability;
  presetKey: string;
  displayName?: string;
  baseUrl?: string;
  defaultModel?: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface ProviderUpdatePatch {
  displayName?: string;
  baseUrl?: string;
  defaultModel?: string;
  enabled?: boolean;
}

// T-26: one token delta from the main process, tagged with the turn id so the
// renderer can discard stale text when a turn is superseded or cancelled.
export interface AssistantTokenPayload {
  turnId: string;
  delta: string;
}

// Result types
export interface SendCommandResult {
  success: boolean;
  message?: string;
  error?: string;
  /** N-04: provider/model that produced the reply (null when not LLM-served). */
  route?: { provider: string; model: string } | null;
}

export interface ToolSchema {
  name: string;
  description: string;
  permissionTier: 'auto' | 'confirm_required';
  parameters: Record<string, unknown>;
}

// N-04: rule-based multi-LLM routing
export interface LlmRoutingRule {
  id: string;
  description: string;
  /** Plain substring (case-insensitive) or a `/.../` regex literal. */
  pattern: string;
  provider: string;
  /** Optional model override; empty uses the provider's configured model. */
  model?: string;
}

export interface LlmRoutingConfig {
  enabled: boolean;
  rules: LlmRoutingRule[];
}

// N-05: scheduled/triggered tasks.
export interface ScheduledTaskInput {
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
}

export interface ScheduledTaskInfo extends ScheduledTaskInput {
  id: string;
  /** Dedicated conversation the task runs into (created on first fire). */
  conversation_id?: string | null;
  last_run_at?: string | null;
  last_status?: 'running' | 'success' | 'failed' | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
  /** Next fire time in ISO, precomputed for enabled tasks; null when disabled/invalid. */
  next_fire_at?: string | null;
  /** Human-readable summary of the cron expression ("Every day at 9:00 AM"). */
  schedule_description?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

export interface MemoryFact {
  id: string;
  key: string;
  value: string;
  source: 'auto_learned' | 'user_added';
  created_at: string;
  updated_at: string;
}

// Result for memory add/edit/delete mutations (T-12)
export interface MemoryMutationResult {
  success: boolean;
  fact?: MemoryFact;
  error?: string;
}

export interface ToolExecution {
  id: string;
  message_id: string | null;
  tool_name: string;
  parameters: Record<string, unknown>;
  permission_tier: 'auto' | 'confirm_required';
  status: 'pending' | 'confirmed' | 'denied' | 'success' | 'failed';
  result: string | null;
  created_at: string;
}

/**
 * Lightweight push payload for kyclius:tool-execution-update (T-14). The
 * renderer refetches the full history on receipt; this only carries what
 * changed so the main process never has to re-read the row.
 */
export interface ToolExecutionUpdate {
  id: string;
  status: ToolExecution['status'];
  result?: string;
}

export interface UserSettings {
  /** N-07: id of the default LLM provider row (preset key or custom UUID). */
  llmProvider: string;
  groqApiKey?: string;
  openRouterApiKey?: string;
  githubToken?: string;
  wakeWord: string;
  backgroundListeningEnabled: boolean;
  voiceConfirmationEnabled: boolean;
  voiceBiometricsEnabled: boolean;
  autonomousModeEnabled: boolean;
  // T-07: Kokoro TTS model paths (manual override; auto-downloaded when unset)
  kokoro_tts_model_path?: string;
  kokoro_tts_voice_path?: string;
  kokoro_tts_tokenizer_path?: string;
  // F-07: local speech-to-text (whisper.cpp) settings
  sttEngine?: SttEngineId;
  whisper_model?: WhisperModelId;
  whisper_binary_path?: string;
  whisper_model_path?: string;
  whisper_language?: string;
  whisper_initial_prompt?: string;
  // F-10: speaker verification model + threshold
  speaker_model_path?: string;
  speaker_threshold?: number;
  // F-09/STT: neural VAD model
  vad_model_path?: string;
}

export interface AutonomousModeConfig {
  enabled: boolean;
  toolOverrides: Record<string, 'auto' | 'confirm_required' | 'never'>;
  maxPlanSteps: number;
  maxPlanDurationSeconds: number;
}

export type AssistantState =
  'idle' | 'listening' | 'thinking' | 'awaiting_confirmation' | 'executing' | 'speaking' | 'error';

export type SttEngineId = 'whisper' | 'system';

// F-07: whisper model catalogue + download
export type WhisperModelId = 'large-v3-turbo' | 'small';

export interface WhisperModelStatus {
  id: WhisperModelId;
  label: string;
  description: string;
  ready: boolean;
}

export interface WhisperDownloadResult {
  ok: boolean;
  path?: string;
  message?: string;
}

export interface WhisperDownloadProgress {
  model: string;
  downloaded: number;
  total: number;
}

export interface VoiceStartResult {
  started: boolean;
  engine: SttEngineId;
}

export interface VoiceError {
  code:
    | 'mic_permission_denied'
    | 'mic_not_found'
    | 'capture_failed'
    | 'stt_engine_unavailable'
    | 'stt_engine_error'
    | 'speaker_unverified'
    | 'no_speech_detected'
    | 'tts_error';
  message: string;
}

// Voice biometrics (F-10)
export interface VoiceEnrollResult {
  ok: boolean;
  error?: string;
  sampleCount?: number;
  enrolledAt?: string;
}

export interface BiometricsStatus {
  enabled: boolean;
  enrolled: boolean;
  /** ISO timestamp of the current enrollment, when a voiceprint exists. */
  enrolledAt?: string;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  permissionTier: 'confirm_required';
  timestamp: number;
  /**
   * False means click-only confirmation mode: the dialog speaks the prompt
   * itself. True/undefined means the main-process voice window owns the TTS
   * read and the dialog must stay silent to avoid double speech.
   */
  voiceConfirmationEnabled?: boolean;
}

export type ConfirmationAction = 'approve' | 'edit' | 'deny' | 'always_allow';

export interface ConfirmationResponse {
  id: string;
  action: ConfirmationAction;
  editedParams?: Record<string, unknown>;
  reason?: string;
}

// Wake word / background listening (F-09)
export type WakeListeningState = 'off' | 'listening' | 'triggered' | 'unavailable';

export interface WakeWordConfig {
  phrase: string;
  enabled: boolean;
  warnings: string[];
}

export interface WakePhraseValidation {
  ok: boolean;
  warnings: string[];
}

// Dashboard (T-17)
export interface DashboardEntry {
  conversation_id: string;
  conversation_title: string;
  question: string;
  input_mode: 'voice' | 'text' | null;
  answer: string;
  last_message_at: string;
  tool_names: string | null;
}

// Dashboard stat cards (T-22) — all sourced from real local data.
export interface DashboardStats {
  conversations: number;
  toolExecutions: number;
  toolSuccessRate: number;
  lastActivityAt: string | null;
}

// N-01: optional Supabase cloud sync
export interface SyncStatus {
  /** Whether this build/run has SUPABASE_URL + SUPABASE_ANON_KEY configured. */
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
  error: string | null;
}

export interface SyncTableResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

export interface SyncRunResult {
  ok: boolean;
  error?: string;
  perTable?: Record<string, SyncTableResult>;
}

export interface SyncConflict {
  id: number;
  table_name: string;
  row_id: string;
  direction: 'local_won' | 'remote_won';
  discarded_json: string;
  resolved_at: string;
}

// N-02: shared/community agents
export type AgentPermissionTier = 'auto' | 'confirm_required';

export interface InstalledAgentInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string | null;
  systemPrompt: string;
  active: boolean;
  installed_at: string;
}

export interface AgentToolReview {
  name: string;
  description: string;
  claimedTier: AgentPermissionTier;
  actualTier: AgentPermissionTier;
  wouldDowngrade: boolean;
  canRunAuto: boolean;
}

export interface AgentImportPreview {
  agent: {
    id: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    systemPrompt: string;
  };
  tools: AgentToolReview[];
  missingTools: string[];
}

export interface AgentImportResult {
  canceled: boolean;
  preview?: AgentImportPreview;
  sourceName?: string;
}

export interface AgentImportConfirmPayload {
  preview: AgentImportPreview;
  approvedAuto: string[];
}

// N-03: third-party plugins
export type PluginCapabilityKind = 'network' | 'filesystem' | 'os' | 'other';

export interface PluginCapabilityInfo {
  kind: PluginCapabilityKind;
  detail: string;
}

export interface InstalledPluginInfo {
  id: string;
  name: string;
  version: string;
  author: string | null;
  description: string;
  active: boolean;
  running: boolean;
  installed_at: string;
  toolNames: string[];
}

export interface PluginToolDisclosureInfo {
  name: string;
  description: string;
  permissionTier: 'auto' | 'confirm_required';
}

export interface PluginInstallPreview {
  manifest: {
    id: string;
    name: string;
    version: string;
    author?: string;
    description: string;
    entry: string;
  };
  capabilities: PluginCapabilityInfo[];
  tools: PluginToolDisclosureInfo[];
  hasAutoTools: boolean;
}

export interface PluginInstallResult {
  canceled: boolean;
  preview?: PluginInstallPreview;
  sourceName?: string;
}

export interface PluginInstallConfirmPayload {
  preview: PluginInstallPreview;
  approvedAuto: string[];
}

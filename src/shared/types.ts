export interface Meeting {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  duration: number
  status: 'recorded' | 'processing' | 'completed' | 'failed'
  audioPath?: string
  audioFilePath?: string
  audioDuration?: number
  transcriptPath?: string
  speakers: Speaker[]
  segments: MeetingSegment[]
  metadata: MeetingMetadata
  aiResults?: AIResults
}

export interface MeetingMetadata {
  platform?: 'zoom' | 'meet' | 'teams' | 'webex' | 'discord' | 'other' | 'unknown'
  participants?: string[]
  startTime?: number
  endTime?: number
  timezone?: string
  deviceInfo?: DeviceInfo
}

export interface DeviceInfo {
  os: string
  arch: string
  audioDevice?: string
  sampleRate: number
  channels: number
}

export interface MeetingSegment {
  id: string
  speakerId: string
  speakerLabel?: string
  text: string
  start: number
  end: number
  confidence: number
  words?: WordTiming[]
  embedding?: number[]
}

export interface WordTiming {
  word: string
  start: number
  end: number
  confidence: number
}

export interface Speaker {
  id: string
  label?: string
  color: string
  segments: string[]
  totalDuration: number
  embedding?: number[]
  enrolledName?: string
  enrolledAt?: number
}

export interface SpeakerProfile {
  id: string
  name: string
  embeddings: number[][]
  createdAt: number
  updatedAt: number
  sampleCount: number
}

export interface Settings {
  dataDirectory: string
  audio: AudioSettings
  transcription: TranscriptionSettings
  diarization: DiarizationSettings
  ai: AISettings
  ui: UISettings
  export: ExportSettings
}

export interface AudioSettings {
  sampleRate: number
  channels: number
  format: 'wav' | 'flac' | 'mp3'
  deviceId?: string
  autoGainControl: boolean
  noiseSuppression: boolean
  echoCancellation: boolean
}

export interface TranscriptionSettings {
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' | 'large-v3-turbo'
  language?: string
  computeType: 'float16' | 'int8' | 'int8_float16'
  beamSize: number
  vadFilter: boolean
  vadThreshold: number
  chunkLength: number
}

export interface DiarizationSettings {
  enabled: boolean
  minSpeakers: number
  maxSpeakers: number
  clusteringThreshold: number
  minDuration: number
}

export interface AISettings {
  enabled: boolean
  provider: AIProvider
  localModels: LocalModelConfig
  cloudProviders: CloudProviderConfig[]
  defaultTasks: AITask[]
}

export interface AIProvider {
  type: 'ollama' | 'openai' | 'anthropic' | 'groq' | 'together' | 'custom'
  name: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface LocalModelConfig {
  ollamaHost: string
  summarization: string
  actions: string
  embeddings: string
  chat: string
}

export interface CloudProviderConfig {
  id: string
  type: 'openai' | 'anthropic' | 'groq' | 'together' | 'custom'
  name: string
  apiKey?: string
  baseUrl?: string
  models: string[]
  defaultModel: string
}

export type AITask = 'summarize' | 'actions' | 'decisions' | 'topics' | 'chat'

export interface AIResults {
  summary?: string
  actionItems?: ActionItem[]
  decisions?: Decision[]
  topics?: TopicSegment[]
  chatHistory?: ChatMessage[]
}

export interface ActionItem {
  id: string
  text: string
  assignee?: string
  dueDate?: number
  status: 'pending' | 'in-progress' | 'completed'
  sourceSegmentIds: string[]
  confidence: number
}

export interface Decision {
  id: string
  text: string
  context: string
  participants: string[]
  sourceSegmentIds: string[]
  confidence: number
}

export interface TopicSegment {
  id: string
  title: string
  startTime: number
  endTime: number
  summary: string
  keywords: string[]
  speakerIds: string[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: {
    tokensUsed?: number
    model?: string
    latency?: number
  }
}

export interface UISettings {
  theme: 'light' | 'dark' | 'system'
  language: string
  autoSave: boolean
  showTimestamps: boolean
  showConfidence: boolean
  fontSize: number
  transcriptDensity: 'compact' | 'comfortable' | 'spacious'
}

export interface ExportSettings {
  defaultFormat: 'markdown' | 'json' | 'srt' | 'vtt' | 'docx' | 'txt'
  includeTimestamps: boolean
  includeSpeakers: boolean
  includeConfidence: boolean
  templatePath?: string
}

export interface ProcessingOptions {
  language?: string
  numSpeakers?: number
  minSpeakers?: number
  maxSpeakers?: number
  enableDiarization: boolean
  enableTranscription: boolean
  customVocabulary?: string[]
}

export interface ProcessingProgress {
  stage: 'vad' | 'diarization' | 'transcription' | 'alignment' | 'embeddings' | 'complete' | 'error'
  progress: number
  message: string
  error?: string
}

export interface RecordingStatus {
  state: 'idle' | 'recording' | 'paused' | 'stopping'
  duration: number
  audioLevel: number
  fileSize: number
  sampleRate: number
  channels: number
}

export interface ModelDownloadProgress {
  stage: 'downloading' | 'extracting' | 'done' | 'error';
  model: string;
  percent: number;
  message: string;
}

export interface SidecarRequest {
  id: string
  method: string
  params: Record<string, unknown>
}

export interface SidecarResponse {
  id: string
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[]
  language: string
  duration: number
}

export interface TranscriptionSegment {
  id: string
  start: number
  end: number
  text: string
  confidence: number
  words?: WordTiming[]
}

export interface DiarizationResult {
  segments: DiarizationSegment[]
  speakers: string[]
}

export interface DiarizationSegment {
  speaker: string
  start: number
  end: number
  embedding?: number[]
}

export interface SpeakerEmbedding {
  speakerId: string
  embedding: number[]
  segments: DiarizationSegment[]
}

export interface RecordingOptions {
  title: string
  meetingDate?: string
}
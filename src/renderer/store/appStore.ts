import { create } from 'zustand'
import type { Meeting, Settings, Speaker, AIProvider, RecordingStatus, ProcessingProgress, ModelDownloadProgress } from '@shared/types'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded'

interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

type RecordingPhase = 'idle' | 'requesting-mic' | 'requesting-screen' | 'recording' | 'saving' | 'done' | 'error'

interface AppState {
  meetings: Meeting[]
  currentMeeting: Meeting | null
  settings: Settings | null
  recordingStatus: RecordingStatus
  recordingPhase: RecordingPhase
  recordingDuration: number
  recordingError: string | null
  recordingTitle: string
  stopRecordingFn: (() => void) | null
  processingProgress: ProcessingProgress | null
  modelDownloadStatus: 'idle' | 'downloading' | 'done' | 'error'
  modelDownloadProgress: ModelDownloadProgress | null
  updateStatus: UpdateStatus
  updateInfo: any
  updateProgress: UpdateProgress | null
  isLoading: boolean
  error: string | null

  setMeetings: (meetings: Meeting[]) => void
  setCurrentMeeting: (meeting: Meeting | null) => void
  setSettings: (settings: Settings) => void
  setRecordingStatus: (status: RecordingStatus) => void
  setRecordingPhase: (phase: RecordingPhase) => void
  setRecordingDuration: (duration: number) => void
  setRecordingError: (error: string | null) => void
  setRecordingTitle: (title: string) => void
  setStopRecordingFn: (fn: (() => void) | null) => void
  stopRecording: () => void
  setProcessingProgress: (progress: ProcessingProgress | null) => void
  setModelDownloadStatus: (status: 'idle' | 'downloading' | 'done' | 'error') => void
  setModelDownloadProgress: (progress: ModelDownloadProgress | null) => void
  setUpdateStatus: (status: UpdateStatus) => void
  setUpdateInfo: (info: any) => void
  setUpdateProgress: (progress: UpdateProgress | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void

  loadMeetings: () => Promise<void>
  loadSettings: () => Promise<void>
  deleteMeeting: (id: string) => Promise<void>
  testAIProvider: (provider: AIProvider) => Promise<{ success: boolean; message: string }>
}

export const useAppStore = create<AppState>((set, get) => ({
  meetings: [],
  currentMeeting: null,
  settings: null,
  recordingStatus: { state: 'idle', duration: 0, audioLevel: 0, fileSize: 0, sampleRate: 16000, channels: 1 },
  recordingPhase: 'idle',
  recordingDuration: 0,
  recordingError: null,
  recordingTitle: '',
  stopRecordingFn: null,
  processingProgress: null,
  modelDownloadStatus: 'idle',
  modelDownloadProgress: null,
  updateStatus: 'idle',
  updateInfo: null,
  updateProgress: null,
  isLoading: false,
  error: null,

  setMeetings: (meetings) => set({ meetings }),
  setCurrentMeeting: (meeting) => set({ currentMeeting: meeting }),
  setSettings: (settings) => set({ settings }),
  setRecordingStatus: (status) => set({ recordingStatus: status }),
  setRecordingPhase: (phase) => set({ recordingPhase: phase }),
  setRecordingDuration: (duration) => set({ recordingDuration: duration }),
  setRecordingError: (error) => set({ recordingError: error }),
  setRecordingTitle: (title) => set({ recordingTitle: title }),
  setStopRecordingFn: (fn) => set({ stopRecordingFn: fn }),
  stopRecording: () => {
    const fn = get().stopRecordingFn
    if (fn) fn()
  },
  setProcessingProgress: (progress) => set({ processingProgress: progress }),
  setModelDownloadStatus: (status) => set({ modelDownloadStatus: status }),
  setModelDownloadProgress: (progress) => set({ modelDownloadProgress: progress }),
  setUpdateStatus: (status) => set({ updateStatus: status }),
  setUpdateInfo: (info) => set({ updateInfo: info }),
  setUpdateProgress: (progress) => set({ updateProgress: progress }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  loadMeetings: async () => {
    set({ isLoading: true })
    try {
      const meetings = await window.api.meetings.list()
      set({ meetings, isLoading: false })
    } catch (err) {
      set({ error: String(err), isLoading: false })
    }
  },

  loadSettings: async () => {
    try {
      const settings = await window.api.settings.get()
      set({ settings })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  deleteMeeting: async (id) => {
    try {
      await window.api.meetings.delete(id)
      const meetings = get().meetings.filter(m => m.id !== id)
      set({ meetings })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  testAIProvider: async (provider) => {
    return window.api.settings.testAIProvider(provider)
  }
}))

import { create } from 'zustand'
import type { Meeting, Settings, Speaker, AIProvider, RecordingStatus, ProcessingProgress } from '@shared/types'

interface AppState {
  meetings: Meeting[]
  currentMeeting: Meeting | null
  settings: Settings | null
  recordingStatus: RecordingStatus
  processingProgress: ProcessingProgress | null
  isLoading: boolean
  error: string | null

  setMeetings: (meetings: Meeting[]) => void
  setCurrentMeeting: (meeting: Meeting | null) => void
  setSettings: (settings: Settings) => void
  setRecordingStatus: (status: RecordingStatus) => void
  setProcessingProgress: (progress: ProcessingProgress | null) => void
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
  processingProgress: null,
  isLoading: false,
  error: null,

  setMeetings: (meetings) => set({ meetings }),
  setCurrentMeeting: (meeting) => set({ currentMeeting: meeting }),
  setSettings: (settings) => set({ settings }),
  setRecordingStatus: (status) => set({ recordingStatus: status }),
  setProcessingProgress: (progress) => set({ processingProgress: progress }),
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

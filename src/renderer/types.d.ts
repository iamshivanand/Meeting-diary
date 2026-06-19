import type { SearchResult } from '@shared/types'

export interface ElectronAPI {
  app: {
    getVersion: () => Promise<string>
    openExternal: (url: string) => Promise<void>
    showSaveDialog: (options: any) => Promise<{ canceled: boolean; filePath?: string }>
    showOpenDialog: (options: any) => Promise<{ canceled: boolean; filePaths?: string[] }>
  }

  onShortcut: (callback: (action: string) => void) => () => void
  onUpdateStatus: (callback: (status: any) => void) => () => void
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>

  saveRecording: (buffer: ArrayBuffer, filename: string) => Promise<string>
  getAudioUrl: (filePath: string) => Promise<string>
  createMeetingFromRecording: (data: { title: string; audioFilePath: string; audioDuration: number }) => Promise<any>

  meetings: {
    list: () => Promise<any[]>
    get: (id: string) => Promise<any | null>
    create: (data: any) => Promise<any>
    update: (id: string, data: any) => Promise<any | null>
    delete: (id: string) => Promise<void>
    startRecording: (meetingId: string) => Promise<{ recordingId: string }>
    stopRecording: (meetingId: string) => Promise<{ audioPath: string; duration: number }>
    processRecording: (meetingId: string, options?: any) => Promise<any>
    export: (meetingId: string, format: any) => Promise<string>
    updateMeetingTags: (id: string, tags: string[]) => Promise<void>
    getAllTags: () => Promise<string[]>
  }
  recording: {
    onStatusChange: (callback: (status: any) => void) => () => void
    onAudioLevel: (callback: (level: number) => void) => () => void
    getDevices: () => Promise<any[]>
  }
  processing: {
    onProgress: (callback: (progress: any) => void) => () => void
  }
  speakers: {
    list: (meetingId: string) => Promise<any[]>
    update: (meetingId: string, speakerId: string, data: any) => Promise<any>
    enroll: (meetingId: string, speakerId: string, name: string, audioSamples: string[]) => Promise<any>
    getRegistry: () => Promise<any[]>
    enrollGlobal: (name: string, audioSamples: string[]) => Promise<any>
  }
  settings: {
    get: () => Promise<any>
    set: (key: string, value: unknown) => Promise<void>
    setAIProvider: (provider: any) => Promise<void>
    testAIProvider: (provider: any) => Promise<{ success: boolean; message: string }>
  }
  ai: {
    summarize: (meetingId: string, options?: any) => Promise<string>
    extractActions: (meetingId: string) => Promise<string>
    extractDecisions: (meetingId: string) => Promise<string>
    segmentTopics: (meetingId: string) => Promise<string>
  }

  searchTranscripts: (query: string, limit?: number) => Promise<SearchResult[]>
  getAllMeetingTitles: () => Promise<Array<{id: string, title: string, date: string}>>
  exportTranscript: (meeting: any, format: string) => Promise<string | null>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

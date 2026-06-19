import { contextBridge, ipcRenderer } from 'electron'

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
    showSaveDialog: (options: any) => ipcRenderer.invoke('app:show-save-dialog', options),
    showOpenDialog: (options: any) => ipcRenderer.invoke('app:show-open-dialog', options)
  },

  onShortcut: (callback: (action: string) => void) => {
    const handler = (_e: any, action: string) => callback(action)
    ipcRenderer.on('shortcut', handler)
    return () => ipcRenderer.removeListener('shortcut', handler)
  },

  onUpdateStatus: (callback: (status: any) => void) => {
    const handler = (_e: any, status: any) => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  meetings: {
    list: () => ipcRenderer.invoke('meetings:list'),
    get: (id: string) => ipcRenderer.invoke('meetings:get', id),
    create: (data: any) => ipcRenderer.invoke('meetings:create', data),
    update: (id: string, data: any) => ipcRenderer.invoke('meetings:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('meetings:delete', id),
    startRecording: (meetingId: string) => ipcRenderer.invoke('meetings:start-recording', meetingId),
    stopRecording: (meetingId: string) => ipcRenderer.invoke('meetings:stop-recording', meetingId),
    processRecording: (meetingId: string, options?: any) =>
      ipcRenderer.invoke('meetings:process-recording', meetingId, options),
    export: (meetingId: string, format: any) => ipcRenderer.invoke('meetings:export', meetingId, format)
  },

  recording: {
    onStatusChange: (callback: (status: any) => void) => {
      const handler = (_e: any, status: any) => callback(status)
      ipcRenderer.on('recording:status', handler)
      return () => ipcRenderer.removeListener('recording:status', handler)
    },
    onAudioLevel: (callback: (level: number) => void) => {
      const handler = (_e: any, level: number) => callback(level)
      ipcRenderer.on('recording:audio-level', handler)
      return () => ipcRenderer.removeListener('recording:audio-level', handler)
    },
    getDevices: () => ipcRenderer.invoke('recording:get-devices')
  },

  processing: {
    onProgress: (callback: (progress: any) => void) => {
      const handler = (_e: any, progress: any) => callback(progress)
      ipcRenderer.on('processing:progress', handler)
      return () => ipcRenderer.removeListener('processing:progress', handler)
    }
  },

  speakers: {
    list: (meetingId: string) => ipcRenderer.invoke('speakers:list', meetingId),
    update: (meetingId: string, speakerId: string, data: any) =>
      ipcRenderer.invoke('speakers:update', meetingId, speakerId, data),
    enroll: (meetingId: string, speakerId: string, name: string, audioSamples: string[]) =>
      ipcRenderer.invoke('speakers:enroll', meetingId, speakerId, name, audioSamples),
    getRegistry: () => ipcRenderer.invoke('speakers:get-registry'),
    enrollGlobal: (name: string, audioSamples: string[]) =>
      ipcRenderer.invoke('speakers:enroll-global', name, audioSamples)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    setAIProvider: (provider: any) => ipcRenderer.invoke('settings:set-ai-provider', provider),
    testAIProvider: (provider: any) => ipcRenderer.invoke('settings:test-ai-provider', provider)
  },

  ai: {
    summarize: (meetingId: string, options?: any) => ipcRenderer.invoke('ai:summarize', meetingId, options),
    extractActions: (meetingId: string) => ipcRenderer.invoke('ai:extract-actions', meetingId),
    extractDecisions: (meetingId: string) => ipcRenderer.invoke('ai:extract-decisions', meetingId),
    segmentTopics: (meetingId: string) => ipcRenderer.invoke('ai:segment-topics', meetingId)
  },

  saveRecording: (buffer: ArrayBuffer, filename: string) => ipcRenderer.invoke('save-recording', { buffer, filename }),
  getAudioUrl: (filePath: string) => ipcRenderer.invoke('get-audio-url', filePath),
  createMeetingFromRecording: (data: { title: string; audioFilePath: string; audioDuration: number }) =>
    ipcRenderer.invoke('create-meeting-from-recording', data),

  models: {
    check: () => ipcRenderer.invoke('check-models'),
    download: () => ipcRenderer.invoke('download-models'),
    onModelDownloadProgress: (callback: (progress: any) => void) => {
      const handler = (_e: any, progress: any) => callback(progress)
      ipcRenderer.on('model-download-progress', handler)
      return () => ipcRenderer.removeListener('model-download-progress', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

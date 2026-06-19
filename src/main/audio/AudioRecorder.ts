import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'

export interface AudioDeviceInfo {
  id: string
  name: string
  groupId: string
  channels: number
  sampleRate: number
  isDefault: boolean
}

export interface RecordingStatus {
  state: 'idle' | 'recording' | 'paused' | 'stopping'
  duration: number
  audioLevel: number
  fileSize: number
  sampleRate: number
  channels: number
}

export class AudioRecorder {
  private recordingsDir: string

  constructor() {
    this.recordingsDir = join(app.getPath('userData'), 'recordings')
    mkdirSync(this.recordingsDir, { recursive: true })
  }

  async saveAudioFile(filename: string, buffer: ArrayBuffer): Promise<string> {
    const filePath = join(this.recordingsDir, filename)
    await writeFile(filePath, Buffer.from(buffer))
    return filePath
  }

  getAudioUrl(filePath: string): string {
    return 'audio://' + filePath
  }

  getRecordingsDir(): string {
    return this.recordingsDir
  }

  async initialize(): Promise<void> {
    // No-op for browser-based recording
  }

  async cleanup(): Promise<void> {
    // No-op for browser-based recording
  }

  async getDevices(): Promise<AudioDeviceInfo[]> {
    return [{ id: 'default', name: 'System Audio', groupId: 'default', channels: 2, sampleRate: 48000, isDefault: true }]
  }

  async startRecording(_outputDir: string, _deviceId?: string): Promise<string> {
    throw new Error('Use browser-based recording via getDisplayMedia/getUserMedia')
  }

  async stopRecording(): Promise<string> {
    throw new Error('Use browser-based recording via getDisplayMedia/getUserMedia')
  }

  getRecordingPath(): string | null {
    return null
  }

  getDuration(): number {
    return 0
  }
}

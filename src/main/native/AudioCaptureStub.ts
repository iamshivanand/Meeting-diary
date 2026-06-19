import { EventEmitter } from 'eventemitter3'

export class AudioCaptureStub extends EventEmitter {
  private level = 0
  private interval: NodeJS.Timeout | null = null

  start(options: { path: string; deviceId?: string | null; sampleRate?: number; channels?: number }): void {
    this.emit('log', { level: 'info', message: `AudioCaptureStub: Starting capture to ${options.path}` })
    this.interval = setInterval(() => {
      this.level = Math.random() * 0.5
      this.emit('audio-level', this.level)
    }, 100)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    this.emit('log', { level: 'info', message: 'AudioCaptureStub: Stopped' })
  }

  pause(): void {}
  resume(): void {}

  getLevel(): number {
    return this.level
  }

  getDevices(): Array<{ id: string; name: string; groupId: string; channels: number; sampleRate: number; isDefault: boolean }> {
    return [{
      id: 'stub-device',
      name: 'System Audio (Stub)',
      groupId: 'default',
      channels: 2,
      sampleRate: 48000,
      isDefault: true
    }]
  }

  destroy(): void {
    this.stop()
    this.removeAllListeners()
  }
}

import { EventEmitter } from 'eventemitter3'
import { join } from 'path'
import { mkdirSync, createWriteStream, WriteStream, existsSync, statSync } from 'fs'
import { v4 as uuid } from 'uuid'
import { execSync, spawn } from 'child_process'
import { NativeModuleLoader } from '../native/NativeModuleLoader'

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

export class AudioRecorder extends EventEmitter {
  private stream: WriteStream | null = null
  private recordingPath: string | null = null
  private recordingId: string | null = null
  private status: RecordingStatus['state'] = 'idle'
  private startTime: number = 0
  private timer: NodeJS.Timeout | null = null
  private captureProcess: any = null
  private nativeCaptureInstance: any = null
  private initialized = false

  async initialize(): Promise<void> {
    const nativeModules = NativeModuleLoader.load()
    let hasFFmpeg = false
    try {
      execSync('ffmpeg -version', { stdio: 'pipe', timeout: 3000 })
      hasFFmpeg = true
    } catch {}

    if (nativeModules?.AudioCapture && !hasFFmpeg) {
      try {
        this.nativeCaptureInstance = new nativeModules.AudioCapture()
        this.nativeCaptureInstance.on('audio-level', (level: number) => {
          this.emit('audio-level', level)
        })
        this.nativeCaptureInstance.on('error', (err: Error) => {
          this.emit('log', { level: 'error', message: err.message })
        })
        console.log('AudioRecorder: Using native capture module')
      } catch (err) {
        console.warn('AudioRecorder: Native capture init failed, using ffmpeg/sox fallback')
        this.nativeCaptureInstance = null
      }
    } else if (hasFFmpeg) {
      console.log('AudioRecorder: Using ffmpeg for audio capture')
    } else {
      console.log('AudioRecorder: No capture backend available, recordings will be silent')
    }
    this.initialized = true
  }

  async getDevices(): Promise<AudioDeviceInfo[]> {
    if (this.nativeCaptureInstance?.getDevices) {
      try { return this.nativeCaptureInstance.getDevices() } catch {}
    }

    try {
      execSync('ffmpeg -version', { stdio: 'pipe', timeout: 3000 })
      const output = execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { timeout: 5000, stdio: 'pipe' }).toString()
      const devices: AudioDeviceInfo[] = []
      const lines = output.split('\n')
      for (const line of lines) {
        const match = line.match(/"(.+?)"/)
        if (match) {
          devices.push({ id: match[1], name: match[1], groupId: 'default', channels: 2, sampleRate: 48000, isDefault: devices.length === 0 })
        }
      }
      if (devices.length > 0) return devices
    } catch {}

    return [{ id: 'default', name: 'System Audio', groupId: 'default', channels: 2, sampleRate: 48000, isDefault: true }]
  }

  async startRecording(outputDir: string, _deviceId?: string): Promise<string> {
    if (this.status === 'recording') throw new Error('Already recording')

    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

    this.recordingId = uuid()
    this.recordingPath = join(outputDir, `${this.recordingId}.wav`)

    if (this.nativeCaptureInstance?.start) {
      try {
        this.nativeCaptureInstance.start({
          path: this.recordingPath,
          sampleRate: 16000,
          channels: 1
        })
      } catch (err) {
        this.emit('log', { level: 'error', message: `Native capture failed: ${err}` })
        this.startFFmpegCapture(this.recordingPath)
      }
    } else {
      this.startFFmpegCapture(this.recordingPath)
    }

    this.status = 'recording'
    this.startTime = Date.now()
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => this.emitStatus(), 250)
    this.emitStatus()
    return this.recordingId
  }

  private startFFmpegCapture(outputPath: string): void {
    try {
      execSync('ffmpeg -version', { stdio: 'pipe', timeout: 3000 })
    } catch {
      this.startDummyCapture(outputPath)
      return
    }

    const platform = process.platform
    let args: string[]

    if (platform === 'win32') {
      args = ['-y', '-f', 'dshow', '-i', 'audio=virtual-audio-capturer', '-ac', '1', '-ar', '16000', outputPath]
    } else if (platform === 'darwin') {
      args = ['-y', '-f', 'avfoundation', '-i', ':1', '-ac', '1', '-ar', '16000', outputPath]
    } else {
      args = ['-y', '-f', 'pulse', '-i', 'default', '-ac', '1', '-ar', '16000', outputPath]
    }

    this.captureProcess = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.captureProcess.stderr?.on('data', (d: Buffer) => this.emit('log', { level: 'ffmpeg', message: d.toString().slice(0, 200) }))
    this.captureProcess.on('error', (err: Error) => this.emit('log', { level: 'error', message: `FFmpeg error: ${err.message}` }))
    this.captureProcess.on('exit', (code: number) => {
      if (this.status === 'recording') this.emit('log', { level: 'warn', message: `FFmpeg exited (code ${code})` })
    })
  }

  private startDummyCapture(outputPath: string): void {
    const header = Buffer.alloc(44)
    const sr = 16000, ch = 1, bps = 16
    const ba = ch * bps / 8
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + sr * ba * 300, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(ch, 22)
    header.writeUInt32LE(sr, 24)
    header.writeUInt32LE(sr * ba, 28)
    header.writeUInt16LE(ba, 32)
    header.writeUInt16LE(bps, 34)
    header.write('data', 36)
    header.writeUInt32LE(sr * ba * 300, 40)

    this.stream = createWriteStream(outputPath)
    this.stream.write(header)
    const buf = Buffer.alloc(ba)
    const iv = setInterval(() => {
      if (this.stream && (this.status === 'recording' || this.status === 'paused')) {
        for (let i = 0; i < sr / 10; i++) this.stream.write(buf)
      }
    }, 100)
    this.captureProcess = { kill: () => clearInterval(iv) }
    this.emit('log', { level: 'warn', message: 'No ffmpeg found. Recording placeholder silence.' })
  }

  async stopRecording(): Promise<string> {
    if (this.status !== 'recording' && this.status !== 'paused') throw new Error('Not recording')
    this.status = 'stopping'

    if (this.nativeCaptureInstance?.stop) {
      try { this.nativeCaptureInstance.stop() } catch {}
    }
    if (this.captureProcess?.kill) {
      if (process.platform === 'win32') {
        try { execSync(`taskkill /PID ${this.captureProcess.pid} /F /T 2>nul`, { stdio: 'pipe' }) } catch {}
      }
      this.captureProcess.kill('SIGTERM')
      await new Promise(r => setTimeout(r, 500))
    }

    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.stream) { await new Promise<void>(r => this.stream!.end(r)); this.stream = null }

    this.status = 'idle'
    const p = this.recordingPath!
    this.recordingId = null
    this.recordingPath = null
    return p
  }

  async pauseRecording(): Promise<void> {
    if (this.status !== 'recording') return
    this.status = 'paused'
    if (this.nativeCaptureInstance?.pause) this.nativeCaptureInstance.pause()
    this.emitStatus()
  }

  async resumeRecording(): Promise<void> {
    if (this.status !== 'paused') return
    this.status = 'recording'
    if (this.nativeCaptureInstance?.resume) this.nativeCaptureInstance.resume()
    this.emitStatus()
  }

  getCurrentStatus(): RecordingStatus['state'] { return this.status }
  getRecordingPath(): string | null { return this.recordingPath }
  getDuration(): number { return this.startTime ? (Date.now() - this.startTime) / 1000 : 0 }

  async cleanup(): Promise<void> {
    if (this.status === 'recording' || this.status === 'paused') {
      try { await this.stopRecording() } catch {}
    }
    if (this.nativeCaptureInstance?.destroy) this.nativeCaptureInstance.destroy()
  }

  private emitStatus(): void {
    let fs = 0
    if (this.recordingPath && existsSync(this.recordingPath)) fs = statSync(this.recordingPath).size
    this.emit('status', { state: this.status, duration: this.getDuration(), audioLevel: 0.5, fileSize: fs, sampleRate: 16000, channels: 1 } as RecordingStatus)
  }
}

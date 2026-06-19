import { ChildProcess, spawn, execSync } from 'child_process'
import { EventEmitter } from 'eventemitter3'
import { createInterface } from 'readline'
import { v4 as uuid } from 'uuid'
import { existsSync } from 'fs'
import { join } from 'path'

interface SidecarRequest {
  id: string
  method: string
  params: Record<string, unknown>
}

interface SidecarResponse {
  id: string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  method?: string
  params?: unknown
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface ProcessingProgress {
  stage: 'vad' | 'diarization' | 'transcription' | 'alignment' | 'embeddings' | 'complete' | 'error'
  progress: number
  message: string
  error?: string
}

export class SidecarManager extends EventEmitter {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private sidecarPath: string
  private initialized = false
  private startupTimeout = 30000
  private requestTimeout = 120000

  constructor(sidecarDistPath: string) {
    super()
    this.sidecarPath = sidecarDistPath
  }

  async start(): Promise<void> {
    if (this.initialized) return

    const pythonCmd = this.findPython()
    const mainScript = join(this.sidecarPath, 'server.py')

    if (!existsSync(mainScript)) {
      throw new Error(`Sidecar server not found at ${mainScript}. Run 'npm run build:sidecar' first.`)
    }

    await new Promise<void>((resolve, reject) => {
      this.process = spawn(pythonCmd, [mainScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })

      const reader = createInterface({ input: this.process.stdout! })
      const errorReader = createInterface({ input: this.process.stderr! })

      reader.on('line', (line: string) => {
        try {
          const msg = JSON.parse(line)
          this.handleMessage(msg)
        } catch {
          if (line.includes('READY')) {
            this.initialized = true
            resolve()
          }
        }
      })

      errorReader.on('line', (line: string) => {
        this.emit('log', { level: 'stderr', message: line })
      })

      this.process.on('error', (err: Error) => {
        this.initialized = false
        reject(err)
      })

      this.process.on('exit', (code: number | null) => {
        this.initialized = false
        this.emit('exit', code)
        if (!this.initialized) {
          reject(new Error(`Sidecar exited with code ${code}`))
        }
      })

      setTimeout(() => {
        if (!this.initialized) {
          reject(new Error('Sidecar startup timed out'))
        }
      }, this.startupTimeout)
    })
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.initialized || !this.process?.stdin) {
      throw new Error('Sidecar not initialized')
    }

    const id = uuid()
    const request: SidecarRequest = { id, method, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request ${method} timed out after ${this.requestTimeout}ms`))
      }, this.requestTimeout)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.process!.stdin!.write(JSON.stringify(request) + '\n')
    })
  }

  async processMeeting(audioPath: string, options: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('process_meeting', {
      audio_path: audioPath,
      options: {
        language: options.language || null,
        num_speakers: options.numSpeakers || null,
        min_speakers: options.minSpeakers || null,
        max_speakers: options.maxSpeakers || null,
        enable_diarization: options.enableDiarization ?? true,
        enable_transcription: options.enableTranscription ?? true,
        model_size: options.model || 'large-v3-turbo',
        compute_type: options.computeType || 'int8_float16',
        custom_vocabulary: options.customVocabulary || []
      }
    })
  }

  async registerSpeaker(name: string, audioSamples: string[]): Promise<unknown> {
    return this.request('register_speaker', { name, audio_samples: audioSamples })
  }

  async identifySpeaker(embedding: number[]): Promise<unknown> {
    return this.request('identify_speaker', { embedding })
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('ping', {})
      return true
    } catch {
      return false
    }
  }

  async stop(): Promise<void> {
    if (!this.process) return
    try {
      if (this.initialized) {
        await this.request('shutdown', {})
      }
    } catch {}
    setTimeout(() => {
      if (this.process) {
        this.process.kill()
        this.process = null
        this.initialized = false
      }
    }, 2000)
  }

  private handleMessage(msg: SidecarResponse): void {
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!
      clearTimeout(pending.timer)
      this.pendingRequests.delete(msg.id)

      if (msg.error) {
        pending.reject(new Error(msg.error.message))
      } else {
        pending.resolve(msg.result)
      }
    } else if (msg.method === 'progress') {
      this.emit('progress', msg.params as ProcessingProgress)
    } else if (msg.method === 'log') {
      this.emit('log', msg.params)
    }
  }

  private findPython(): string {
    const candidates = ['python3', 'python', 'py']
    for (const cmd of candidates) {
      try {
        const result = execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 })
        if (result) return cmd
      } catch {}
    }
    return 'python'
  }
}

import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { v4 as uuid } from 'uuid'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'
import type { SidecarManager, ModelDownloadProgress } from '../sidecar/SidecarManager'
import type { AudioRecorder } from '../audio/AudioRecorder'
import type { MeetingStore } from '../store/MeetingStore'
import type { SettingsStore } from '../store/SettingsStore'
import type { Meeting, MeetingSegment, Speaker, AIProvider } from '../../shared/types'

interface HandlerDeps {
  mainWindow: BrowserWindow | null
  audioRecorder: AudioRecorder
  sidecarManager: SidecarManager
  settingsStore: SettingsStore
  meetingStore: MeetingStore
}

export class IPCHandlers {
  private deps: HandlerDeps

  constructor(deps: HandlerDeps) {
    this.deps = deps
  }

  register(): void {
    this.registerMeetingHandlers()
    this.registerRecordingHandlers()
    this.registerSpeakerHandlers()
    this.registerSettingsHandlers()
    this.registerAIHandlers()
    this.registerModelHandlers()
    this.setupProgressForwarding()
  }

  private registerMeetingHandlers(): void {
    ipcMain.handle('meetings:list', async () => {
      return this.deps.meetingStore.listMeetings()
    })

    ipcMain.handle('meetings:get', async (_e, id: string) => {
      return this.deps.meetingStore.getMeeting(id)
    })

    ipcMain.handle('meetings:create', async (_e, data: Partial<Meeting>) => {
      return this.deps.meetingStore.createMeeting(data)
    })

    ipcMain.handle('meetings:update', async (_e, id: string, data: Partial<Meeting>) => {
      await this.deps.meetingStore.updateMeeting(id, data)
      return this.deps.meetingStore.getMeeting(id)
    })

    ipcMain.handle('meetings:delete', async (_e, id: string) => {
      await this.deps.meetingStore.deleteMeeting(id)
    })

    ipcMain.handle('meetings:process-recording', async (_e, meetingId: string, options?: any) => {
      return this.handleProcessing(meetingId, options)
    })

    ipcMain.handle('meetings:export', async (_e, meetingId: string, format: any) => {
      return this.handleExport(meetingId, format)
    })
  }

  private registerRecordingHandlers(): void {
    ipcMain.handle('recording:get-devices', () => {
      return this.deps.audioRecorder.getDevices()
    })

    ipcMain.handle('meetings:start-recording', async (_e, meetingId: string) => {
      const settings = this.deps.settingsStore.get('dataDirectory')
      const meetingsDir = join(settings, 'audio')
      if (!existsSync(meetingsDir)) mkdirSync(meetingsDir, { recursive: true })

      try {
        const recordingId = await this.deps.audioRecorder.startRecording(meetingsDir)
        await this.deps.meetingStore.updateMeeting(meetingId, {
          audioPath: this.deps.audioRecorder.getRecordingPath() || undefined
        })
        return { recordingId }
      } catch (err) {
        throw new Error(`Failed to start recording: ${err}`)
      }
    })

    ipcMain.handle('meetings:stop-recording', async (_e, meetingId: string) => {
      try {
        const audioPath = await this.deps.audioRecorder.stopRecording()
        const duration = this.deps.audioRecorder.getDuration()
        await this.deps.meetingStore.updateMeeting(meetingId, { status: 'recorded', audioPath, duration })
        return { audioPath, duration }
      } catch (err) {
        throw new Error(`Failed to stop recording: ${err}`)
      }
    })
  }

  private registerSpeakerHandlers(): void {
    ipcMain.handle('speakers:list', async (_e, meetingId: string) => {
      const meeting = await this.deps.meetingStore.getMeeting(meetingId)
      return meeting?.speakers || []
    })

    ipcMain.handle('speakers:update', async (_e, meetingId: string, speakerId: string, data: Partial<Speaker>) => {
      await this.deps.meetingStore.updateSpeaker(meetingId, speakerId, data)
      const meeting = await this.deps.meetingStore.getMeeting(meetingId)
      return meeting?.speakers.find(s => s.id === speakerId)
    })

    ipcMain.handle('speakers:enroll', async (_e, meetingId: string, speakerId: string, name: string, audioSamples: string[]) => {
      let result: any
      try {
        result = await this.deps.sidecarManager.registerSpeaker(name, audioSamples)
      } catch {
        result = { id: uuid(), name, local: true }
      }
      await this.deps.meetingStore.updateSpeaker(meetingId, speakerId, { enrolledName: name, enrolledAt: Date.now() })
      return result
    })

    ipcMain.handle('speakers:get-registry', async () => {
      return this.deps.meetingStore.getSpeakerRegistry()
    })

    ipcMain.handle('speakers:enroll-global', async (_e, name: string, audioSamples: string[]) => {
      let result: any
      try {
        result = await this.deps.sidecarManager.registerSpeaker(name, audioSamples)
      } catch {
        result = { id: uuid(), name }
      }
      await this.deps.meetingStore.addSpeakerProfile(name, [])
      return result
    })
  }

  private registerSettingsHandlers(): void {
    ipcMain.handle('settings:get', () => {
      return this.deps.settingsStore.getAll()
    })

    ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
      this.deps.settingsStore.set(key as any, value)
    })

    ipcMain.handle('settings:set-ai-provider', (_e, provider: AIProvider) => {
      this.deps.settingsStore.setAIProvider(provider)
    })

    ipcMain.handle('settings:test-ai-provider', async (_e, provider: AIProvider) => {
      try {
        if (provider.type === 'ollama') {
          const host = typeof provider.config?.host === 'string' ? provider.config.host : 'http://localhost:11434'
          const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) })
          return { success: response.ok, message: response.ok ? 'Connected to Ollama' : `Status: ${response.status}` }
        }
        if (provider.config?.apiKey) {
          const baseUrl = typeof provider.config?.baseUrl === 'string'
            ? provider.config.baseUrl.replace(/\/$/, '')
            : this.getDefaultBaseUrl(provider.type)
          const model = typeof provider.config?.defaultModel === 'string'
            ? provider.config.defaultModel
            : this.getDefaultModel(provider.type)
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.config.apiKey}`
            },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'test' }], max_tokens: 1 }),
            signal: AbortSignal.timeout(10000)
          })
          return { success: response.ok, message: response.ok ? 'Connected successfully' : `Error: ${response.status}` }
        }
        return { success: false, message: 'No API key configured. Add one in Settings.' }
      } catch (err: any) {
        return { success: false, message: err?.message || String(err) }
      }
    })
  }

  private registerAIHandlers(): void {
    ipcMain.handle('ai:summarize', async (_e, meetingId: string, options?: any) => {
      return this.handleAIAction(meetingId, 'summarize', options)
    })

    ipcMain.handle('ai:extract-actions', async (_e, meetingId: string) => {
      return this.handleAIAction(meetingId, 'extract-actions')
    })

    ipcMain.handle('ai:extract-decisions', async (_e, meetingId: string) => {
      return this.handleAIAction(meetingId, 'extract-decisions')
    })

    ipcMain.handle('ai:segment-topics', async (_e, meetingId: string) => {
      return this.handleAIAction(meetingId, 'segment-topics')
    })
  }

  private registerModelHandlers(): void {
    ipcMain.handle('download-models', async (event) => {
      const win = this.deps.mainWindow
      await this.deps.sidecarManager.downloadModels((progress) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('model-download-progress', progress)
        }
      })
      return { status: 'done' }
    })

    ipcMain.handle('check-models', async () => {
      try {
        const result = await this.deps.sidecarManager.request('check_models', {})
        return result as { downloaded: boolean }
      } catch {
        return { downloaded: false }
      }
    })
  }

  private async handleProcessing(meetingId: string, options?: any): Promise<unknown> {
    const meeting = await this.deps.meetingStore.getMeeting(meetingId)
    if (!meeting?.audioPath) throw new Error('No audio file found')
    if (!existsSync(meeting.audioPath)) throw new Error('Audio file not found')

    await this.deps.meetingStore.updateMeeting(meetingId, { status: 'processing' })
    this.sendProgress({ stage: 'vad', progress: 0, message: 'Starting processing' })

    try {
      const settings = this.deps.settingsStore.get('diarization')

      let result: any
      try {
        result = await this.deps.sidecarManager.processMeeting(meeting.audioPath, {
          language: options?.language,
          maxSpeakers: options?.maxSpeakers || settings.maxSpeakers,
          minSpeakers: options?.minSpeakers || settings.minSpeakers,
          enableDiarization: options?.enableDiarization ?? settings.enabled,
          enableTranscription: options?.enableTranscription ?? true,
          customVocabulary: options?.customVocabulary || []
        })
      } catch (err) {
        this.sendProgress({ stage: 'error', progress: 0, message: String(err) })
        throw err
      }

      const resultData = result as any || {}
      const resultSegments: MeetingSegment[] = (resultData.segments || []).map((s: any) => ({
        id: s.id || uuid(),
        speakerId: s.speaker_id || 'SPEAKER_00',
        speakerLabel: s.speaker_label || null,
        text: s.text || '',
        start: s.start || 0,
        end: s.end || 0,
        confidence: s.confidence || 0,
        words: s.words || undefined
      }))

      const resultSpeakers: Speaker[] = (resultData.speakers || []).map((s: any) => ({
        id: s.id || 'SPEAKER_00',
        label: s.label || null,
        color: s.color || '#4A90D9',
        segments: s.segments || [],
        totalDuration: s.total_duration || 0,
        enrolledName: s.enrolled_name || null,
        enrolledAt: s.enrolled_at || null
      }))

      this.sendProgress({ stage: 'complete', progress: 100, message: 'Processing complete' })

      await this.deps.meetingStore.replaceSegments(meetingId, resultSegments)
      await this.deps.meetingStore.replaceSpeakers(meetingId, resultSpeakers)
      await this.deps.meetingStore.updateMeeting(meetingId, { status: 'completed' })

      return { segments: resultSegments, speakers: resultSpeakers }
    } catch (err) {
      await this.deps.meetingStore.updateMeeting(meetingId, { status: 'failed' })
      this.sendProgress({ stage: 'error', progress: 0, message: String(err) })
      throw err
    }
  }

  private async handleExport(meetingId: string, format: { type: string; options?: Record<string, unknown> }): Promise<string> {
    const meeting = await this.deps.meetingStore.getMeeting(meetingId)
    if (!meeting) throw new Error('Meeting not found')

    const exportDir = join(this.deps.settingsStore.get('dataDirectory'), 'exports')
    if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true })

    const date = new Date(meeting.createdAt).toISOString().split('T')[0]
    const safeTitle = meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    let outputPath: string

    switch (format.type) {
      case 'markdown':
        outputPath = join(exportDir, `${safeTitle}_${date}.md`)
        writeFileSync(outputPath, this.generateMarkdown(meeting), 'utf-8')
        break
      case 'json':
        outputPath = join(exportDir, `${safeTitle}_${date}.json`)
        writeFileSync(outputPath, JSON.stringify(meeting, null, 2), 'utf-8')
        break
      case 'txt':
        outputPath = join(exportDir, `${safeTitle}_${date}.txt`)
        writeFileSync(outputPath, this.generatePlainText(meeting), 'utf-8')
        break
      case 'srt':
        outputPath = join(exportDir, `${safeTitle}_${date}.srt`)
        writeFileSync(outputPath, this.generateSRT(meeting), 'utf-8')
        break
      case 'vtt':
        outputPath = join(exportDir, `${safeTitle}_${date}.vtt`)
        writeFileSync(outputPath, this.generateVTT(meeting), 'utf-8')
        break
      case 'docx':
        outputPath = join(exportDir, `${safeTitle}_${date}.docx`)
        writeFileSync(outputPath, await this.generateDocx(meeting))
        break
      default:
        throw new Error(`Unsupported export format: ${format.type}`)
    }

    return outputPath
  }

  private async handleAIAction(meetingId: string, action: string, _options?: any): Promise<string> {
    const meeting = await this.deps.meetingStore.getMeeting(meetingId)
    if (!meeting) throw new Error('Meeting not found')

    const settings = this.deps.settingsStore.getAll()
    const aiSettings = settings.ai

    if (!aiSettings.enabled) throw new Error('AI features are disabled. Enable in Settings.')

    const transcript = meeting.segments
      .map(s => `[${this.formatTime(s.start)}] ${s.speakerLabel || s.speakerId}: ${s.text}`)
      .join('\n')

    const provider = aiSettings.provider
    const prompt = this.buildPrompt(action, transcript)

    let result: string

    if (provider.type === 'ollama') {
      result = await this.callOllama(provider, prompt)
    } else if (provider.config?.apiKey) {
      result = await this.callCloudAPI(provider, prompt)
    } else {
      result = 'No AI provider configured. Go to Settings → AI to add an API key or enable Ollama.\n\nTranscript length: ' +
        meeting.segments.length + ' segments, ' + transcript.length + ' characters.'
    }

    return result
  }

  private async callOllama(provider: AIProvider, prompt: string): Promise<string> {
    const host = typeof provider.config?.host === 'string' ? provider.config.host : 'http://localhost:11434'
    const model = typeof provider.config?.model === 'string' ? provider.config.model : 'llama3.2:3b'

    try {
      const response = await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: 4096 } }),
        signal: AbortSignal.timeout(120000)
      })

      if (!response.ok) throw new Error(`Ollama error: ${response.status}`)
      const data: any = await response.json()
      return data.response || 'No response from Ollama'
    } catch (err: any) {
      return `Failed to connect to Ollama at ${host}. Make sure Ollama is running.\nError: ${err.message}`
    }
  }

  private async callCloudAPI(provider: AIProvider, prompt: string): Promise<string> {
    const baseUrl = typeof provider.config?.baseUrl === 'string'
      ? provider.config.baseUrl.replace(/\/$/, '')
      : this.getDefaultBaseUrl(provider.type)
    const model = typeof provider.config?.defaultModel === 'string'
      ? provider.config.defaultModel
      : this.getDefaultModel(provider.type)
    const apiKey = provider.config?.apiKey
    if (!apiKey) return 'No API key configured for this provider. Go to Settings to add one.'

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a meeting analysis assistant. Provide concise, structured analysis.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 4096
        }),
        signal: AbortSignal.timeout(120000)
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        return `API error (${response.status}): ${errBody.slice(0, 200)}`
      }

      const data: any = await response.json()
      return data.choices?.[0]?.message?.content || 'No response from API'
    } catch (err: any) {
      return `Failed to call API: ${err.message}`
    }
  }

  private buildPrompt(action: string, transcript: string): string {
    switch (action) {
      case 'summarize':
        return `Summarize this meeting transcript. Include: main topics discussed, key points, and conclusions.\n\nTranscript:\n${transcript}`
      case 'extract-actions':
        return `Extract all action items from this meeting transcript. For each, list: the action, who is responsible, and any deadline mentioned. Format as a numbered list.\n\nTranscript:\n${transcript}`
      case 'extract-decisions':
        return `Extract all decisions made during this meeting. For each, describe: what was decided, who was involved, and any context.\n\nTranscript:\n${transcript}`
      case 'segment-topics':
        return `Divide this meeting transcript into topic segments. For each segment provide: topic title, approximate timestamp range, and brief summary.\n\nTranscript:\n${transcript}`
      default:
        return transcript
    }
  }

  private getDefaultBaseUrl(type: string): string {
    const urls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      together: 'https://api.together.xyz/v1',
      custom: 'http://localhost:8080/v1'
    }
    return urls[type] || 'http://localhost:8080/v1'
  }

  private getDefaultModel(type: string): string {
    const models: Record<string, string> = {
      openai: 'gpt-4o-mini',
      anthropic: 'claude-3-5-haiku-20241022',
      groq: 'llama-3.1-70b-versatile',
      together: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
      custom: 'default'
    }
    return models[type] || 'default'
  }

  private lastProgressTime = 0
  private sendProgress(progress: any): void {
    if (this.deps.mainWindow && !this.deps.mainWindow.isDestroyed()) {
      this.deps.mainWindow.webContents.send('processing:progress', progress)
    }
  }

  private setupProgressForwarding(): void {
    this.deps.sidecarManager.on('progress', (progress: any) => {
      const now = Date.now()
      if (now - this.lastProgressTime < 100) return
      this.lastProgressTime = now
      this.sendProgress(progress)
    })
    this.deps.sidecarManager.on('log', (log: any) => {
      console.log('[sidecar]', log)
    })
  }

  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  private generateMarkdown(meeting: Meeting): string {
    const lines: string[] = [
      `# ${meeting.title}`,
      '',
      `**Date:** ${new Date(meeting.createdAt).toLocaleString()}`,
      `**Duration:** ${Math.round(meeting.duration)} seconds`,
      `**Speakers:** ${meeting.speakers.map(s => s.label || s.enrolledName || s.id).join(', ')}`,
      '',
      '---',
      ''
    ]
    for (const seg of meeting.segments) {
      const speaker = seg.speakerLabel || meeting.speakers.find(s => s.id === seg.speakerId)?.enrolledName || seg.speakerId
      lines.push(`**${speaker}** *[${this.formatTime(seg.start)} - ${this.formatTime(seg.end)}]*`)
      lines.push(seg.text)
      lines.push('')
    }
    return lines.join('\n')
  }

  private generatePlainText(meeting: Meeting): string {
    return meeting.segments.map(s => {
      const speaker = s.speakerLabel || meeting.speakers.find(sp => sp.id === s.speakerId)?.enrolledName || s.speakerId
      return `[${this.formatTime(s.start)}] ${speaker}: ${s.text}`
    }).join('\n')
  }

  private generateSRT(meeting: Meeting): string {
    return meeting.segments.map((s, i) => {
      const speaker = s.speakerLabel || meeting.speakers.find(sp => sp.id === s.speakerId)?.enrolledName || s.speakerId
      return `${i + 1}\n${this.toSRTTime(s.start)} --> ${this.toSRTTime(s.end)}\n${speaker}: ${s.text}`
    }).join('\n\n')
  }

  private generateVTT(meeting: Meeting): string {
    return `WEBVTT\n\n${meeting.segments.map((s, i) => {
      const speaker = s.speakerLabel || meeting.speakers.find(sp => sp.id === s.speakerId)?.enrolledName || s.speakerId
      return `${this.toVTTTime(s.start)} --> ${this.toVTTTime(s.end)}\n<v ${speaker}>${s.text}`
    }).join('\n\n')}`
  }

  private toSRTTime(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
  }

  private toVTTTime(seconds: number): string {
    return this.toSRTTime(seconds).replace(',', '.')
  }

  private async generateDocx(meeting: Meeting): Promise<Buffer> {
    const children: (Paragraph)[] = [
      new Paragraph({ text: meeting.title, heading: HeadingLevel.TITLE }),
      new Paragraph({
        children: [
          new TextRun({ text: `Date: ${new Date(meeting.createdAt).toLocaleString()}`, size: 20 }),
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Duration: ${Math.round(meeting.duration)} seconds`, size: 20 }),
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `Speakers: ${meeting.speakers.map(s => s.label || s.enrolledName || s.id).join(', ')}`, size: 20 }),
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({ children: [new TextRun({ text: '' })] }),
    ]

    for (const seg of meeting.segments) {
      const speaker = seg.speakerLabel || meeting.speakers.find(s => s.id === seg.speakerId)?.enrolledName || seg.speakerId
      const timeStr = `${this.formatTime(seg.start)} - ${this.formatTime(seg.end)}`
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${speaker}`, bold: true }),
            new TextRun({ text: ` [${timeStr}]`, size: 20, color: '666666' }),
          ],
          spacing: { before: 200, after: 60 }
        }),
        new Paragraph({
          children: [new TextRun({ text: seg.text || '' })],
          spacing: { after: 200 }
        })
      )
    }

    const doc = new Document({ sections: [{ children }] })
    return Buffer.from(await Packer.toBuffer(doc))
  }
}

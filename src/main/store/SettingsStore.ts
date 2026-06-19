import { app } from 'electron'
import Store from 'electron-store'
import { join } from 'path'
import type { Settings, AIProvider, CloudProviderConfig, LocalModelConfig } from '../../shared/types'

function getDefaultSettings(): Settings {
  return {
    dataDirectory: join(app.getPath('userData'), 'meetings'),
    audio: {
      sampleRate: 16000,
      channels: 1,
      format: 'wav',
      autoGainControl: true,
      noiseSuppression: true,
      echoCancellation: true
    },
    transcription: {
      model: 'large-v3-turbo',
      computeType: 'int8_float16',
      beamSize: 5,
      vadFilter: true,
      vadThreshold: 0.5,
      chunkLength: 30
    },
    diarization: {
      enabled: true,
      minSpeakers: 1,
      maxSpeakers: 10,
      clusteringThreshold: 0.7,
      minDuration: 1.0
    },
    ai: {
      enabled: true,
      provider: {
        type: 'ollama',
        name: 'Ollama (Local)',
        enabled: true,
        config: {
          host: 'http://localhost:11434'
        }
      },
      localModels: {
        ollamaHost: 'http://localhost:11434',
        summarization: 'qwen2.5:7b',
        actions: 'phi3:mini',
        embeddings: 'nomic-embed-text',
        chat: 'llama3.2:3b'
      },
      cloudProviders: [
        {
          id: 'openai',
          type: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
          defaultModel: 'gpt-4o-mini'
        },
        {
          id: 'anthropic',
          type: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com',
          models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
          defaultModel: 'claude-3-5-haiku-20241022'
        },
        {
          id: 'groq',
          type: 'groq',
          name: 'Groq',
          baseUrl: 'https://api.groq.com/openai/v1',
          models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
          defaultModel: 'llama-3.1-70b-versatile'
        }
      ],
      defaultTasks: ['summarize', 'actions', 'decisions']
    },
    ui: {
      theme: 'system',
      language: 'en',
      autoSave: true,
      showTimestamps: true,
      showConfidence: false,
      fontSize: 14,
      transcriptDensity: 'comfortable'
    },
    export: {
      defaultFormat: 'markdown',
      includeTimestamps: true,
      includeSpeakers: true,
      includeConfidence: false
    }
  }
}

export class SettingsStore {
  private store: Store<Settings>

  constructor() {
    this.store = new Store<Settings>({
      name: 'settings',
      defaults: getDefaultSettings()
    })
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.store.get(key as string) as any as Settings[K]
  }

  getAll(): Settings {
    return this.store.store as unknown as Settings
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.store.set(key as string, value as any)
  }

  setAIProvider(provider: AIProvider): void {
    this.store.set('ai.provider', provider as any)
  }

  addCloudProvider(config: CloudProviderConfig): void {
    const providers = this.store.get('ai.cloudProviders') as CloudProviderConfig[]
    const existing = providers.findIndex(p => p.id === config.id)
    if (existing >= 0) {
      providers[existing] = config
    } else {
      providers.push(config)
    }
    this.store.set('ai.cloudProviders', providers as any)
  }

  removeCloudProvider(id: string): void {
    const providers = (this.store.get('ai.cloudProviders') as CloudProviderConfig[]).filter(p => p.id !== id)
    this.store.set('ai.cloudProviders', providers as any)
  }

  updateCloudProvider(id: string, updates: Partial<CloudProviderConfig>): void {
    const providers = (this.store.get('ai.cloudProviders') as CloudProviderConfig[]).map(p =>
      p.id === id ? { ...p, ...updates } : p
    )
    this.store.set('ai.cloudProviders', providers as any)
  }

  updateLocalModels(config: Partial<LocalModelConfig>): void {
    const current = this.store.get('ai.localModels') as LocalModelConfig
    this.store.set('ai.localModels', { ...current, ...config } as any)
  }

  reset(): void {
    this.store.clear()
  }

  onDidChange(key: keyof Settings, callback: (newValue: unknown, oldValue: unknown) => void): () => void {
    return this.store.onDidChange(key, callback as any)
  }
}

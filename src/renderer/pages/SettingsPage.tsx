import React, { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import type { Settings, AIProvider, CloudProviderConfig } from '@shared/types'

interface Props {
  onBack: () => void
}

export function SettingsPage({ onBack }: Props) {
  const { settings, loadSettings, testAIProvider } = useAppStore()
  const [localSettings, setLocalSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [activeTab, setActiveTab] = useState<'ai' | 'transcription' | 'diarization' | 'audio' | 'general'>('ai')

  useEffect(() => {
    if (settings) setLocalSettings(JSON.parse(JSON.stringify(settings)))
  }, [settings])

  useEffect(() => { loadSettings() }, [])

  if (!localSettings) return <div style={styles.loading}>Loading settings...</div>

  const handleSave = async () => {
    if (!localSettings) return
    setSaving(true)
    try {
      for (const [key, value] of Object.entries(localSettings)) {
        await window.api.settings.set(key, value as any)
      }
      await loadSettings()
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
    setSaving(false)
  }

  const handleAddCloudProvider = () => {
    if (!localSettings) return
    const newProvider: CloudProviderConfig = {
      id: `provider-${Date.now()}`,
      type: 'openai',
      name: 'New Provider',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
      defaultModel: 'gpt-4o-mini'
    }
    setLocalSettings({
      ...localSettings,
      ai: {
        ...localSettings.ai,
        cloudProviders: [...localSettings.ai.cloudProviders, newProvider]
      }
    })
  }

  const handleRemoveCloudProvider = (id: string) => {
    if (!localSettings) return
    setLocalSettings({
      ...localSettings,
      ai: {
        ...localSettings.ai,
        cloudProviders: localSettings.ai.cloudProviders.filter(p => p.id !== id)
      }
    })
  }

  const handleUpdateCloudProvider = (id: string, updates: Partial<CloudProviderConfig>) => {
    if (!localSettings) return
    setLocalSettings({
      ...localSettings,
      ai: {
        ...localSettings.ai,
        cloudProviders: localSettings.ai.cloudProviders.map(p =>
          p.id === id ? { ...p, ...updates } : p
        )
      }
    })
  }

  const handleTestProvider = async () => {
    if (!localSettings) return
    setTestResult(null)
    const result = await testAIProvider(localSettings.ai.provider)
    setTestResult(result)
  }

  const ollamaModels = ['llama3.2:latest', 'llama3.1:latest', 'mistral:latest', 'mixtral:latest', 'phi3:latest', 'qwen2.5:latest']

  const availableModels: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    together: ['mistralai/Mixtral-8x7B-Instruct-v0.1', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    custom: []
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <h1 style={styles.title}>Settings</h1>
        <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </header>

      <div style={styles.layout}>
        <nav style={styles.sidebar}>
          {(['ai', 'transcription', 'diarization', 'audio', 'general'] as const).map(tab => (
            <button
              key={tab}
              style={{
                ...styles.sidebarItem,
                background: activeTab === tab ? '#e8f0fe' : 'transparent',
                color: activeTab === tab ? '#1a73e8' : '#333'
              }}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        <main style={styles.content}>
          {activeTab === 'ai' && (
            <div>
              <h2 style={styles.sectionTitle}>AI Provider Configuration</h2>
              <p style={styles.sectionDesc}>
                Choose how AI features work. Use a local Ollama model (free, privacy-first) or add cloud API keys for higher quality.
              </p>

              <div style={styles.providerToggle}>
                <label style={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={localSettings.ai.enabled}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      ai: { ...localSettings.ai, enabled: e.target.checked }
                    })}
                  />
                  <span>Enable AI Features</span>
                </label>
              </div>

              {localSettings.ai.enabled && (
                <>
                  <h3 style={styles.subTitle}>Primary Provider</h3>
                  <div style={styles.card}>
                    <div style={styles.field}>
                      <label style={styles.label}>Provider Type</label>
                      <select
                        style={styles.select}
                        value={localSettings.ai.provider.type}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          ai: {
                            ...localSettings.ai,
                            provider: {
                              ...localSettings.ai.provider,
                              type: e.target.value as any,
                              name: e.target.value === 'ollama' ? 'Ollama (Local)' :
                                e.target.value === 'openai' ? 'OpenAI' :
                                e.target.value === 'anthropic' ? 'Anthropic' :
                                e.target.value === 'groq' ? 'Groq (Free)' :
                                e.target.value === 'together' ? 'Together AI' : 'Custom'
                            }
                          }
                        })}
                      >
                        <option value="ollama">Ollama (Local - Free)</option>
                        <option value="openai">OpenAI (GPT-4o, GPT-4o-mini)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="groq">Groq (Free Tier)</option>
                        <option value="together">Together AI</option>
                        <option value="custom">Custom (OpenAI-compatible)</option>
                      </select>
                    </div>

                    {localSettings.ai.provider.type === 'ollama' ? (
                      <>
                        <div style={styles.field}>
                          <label style={styles.label}>Ollama Host</label>
                          <input
                            style={styles.input}
                            value={(localSettings.ai.provider.config?.host as string) || 'http://localhost:11434'}
                            onChange={e => {
                              const config = { ...localSettings.ai.provider.config, host: e.target.value }
                              setLocalSettings({
                                ...localSettings,
                                ai: {
                                  ...localSettings.ai,
                                  provider: { ...localSettings.ai.provider, config }
                                }
                              })
                            }}
                            placeholder="http://localhost:11434"
                          />
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Model</label>
                          <select
                            style={styles.select}
                            value={(localSettings.ai.provider.config?.model as string) || 'llama3.2:latest'}
                            onChange={e => {
                              const config = { ...localSettings.ai.provider.config, model: e.target.value }
                              setLocalSettings({
                                ...localSettings,
                                ai: { ...localSettings.ai, provider: { ...localSettings.ai.provider, config } }
                              })
                            }}
                          >
                            {ollamaModels.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ ...styles.field, fontSize: 12, color: '#888' }}>
                          Requires Ollama to be running locally (<a href="#" onClick={e => { e.preventDefault(); window.api.app.openExternal('https://ollama.ai') }}>ollama.ai</a>)
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={styles.field}>
                          <label style={styles.label}>API Key</label>
                          <input
                            style={styles.input}
                            type="password"
                            value={(localSettings.ai.provider.config?.apiKey as string) || ''}
                            onChange={e => {
                              const config = { ...localSettings.ai.provider.config, apiKey: e.target.value }
                              setLocalSettings({
                                ...localSettings,
                                ai: {
                                  ...localSettings.ai,
                                  provider: { ...localSettings.ai.provider, config }
                                }
                              })
                            }}
                            placeholder="sk-..."
                          />
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Base URL</label>
                          <input
                            style={styles.input}
                            value={localSettings.ai.provider.config?.baseUrl as string || localSettings.ai.cloudProviders.find(p => p.type === localSettings.ai.provider.type)?.baseUrl || ''}
                            onChange={e => {
                              const config = { ...localSettings.ai.provider.config, baseUrl: e.target.value }
                              setLocalSettings({
                                ...localSettings,
                                ai: { ...localSettings.ai, provider: { ...localSettings.ai.provider, config } }
                              })
                            }}
                          />
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Model</label>
                          <select
                            style={styles.select}
                            value={(localSettings.ai.provider.config?.defaultModel as string) || 'gpt-4o-mini'}
                            onChange={e => {
                              const config = { ...localSettings.ai.provider.config, defaultModel: e.target.value }
                              setLocalSettings({
                                ...localSettings,
                                ai: { ...localSettings.ai, provider: { ...localSettings.ai.provider, config } }
                              })
                            }}
                          >
                            {(availableModels[localSettings.ai.provider.type] || ['gpt-4o-mini']).map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                            <option value="custom">Custom model</option>
                          </select>
                        </div>
                      </>
                    )}

                    <div style={styles.field}>
                      <button style={styles.testBtn} onClick={handleTestProvider}>Test Connection</button>
                      {testResult && (
                        <span style={{
                          ...styles.testResult,
                          color: testResult.success ? '#27ae60' : '#e74c3c'
                        }}>
                          {testResult.success ? '✓' : '✗'} {testResult.message}
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 style={styles.subTitle}>Local Models (Ollama)</h3>
                  <div style={styles.card}>
                    <div style={styles.field}>
                      <label style={styles.label}>Summarization Model</label>
                      <input
                        style={styles.input}
                        value={localSettings.ai.localModels.summarization}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          ai: {
                            ...localSettings.ai,
                            localModels: { ...localSettings.ai.localModels, summarization: e.target.value }
                          }
                        })}
                        placeholder="qwen2.5:7b"
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Actions Model</label>
                      <input
                        style={styles.input}
                        value={localSettings.ai.localModels.actions}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          ai: {
                            ...localSettings.ai,
                            localModels: { ...localSettings.ai.localModels, actions: e.target.value }
                          }
                        })}
                        placeholder="phi3:mini"
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Embeddings Model</label>
                      <input
                        style={styles.input}
                        value={localSettings.ai.localModels.embeddings}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          ai: {
                            ...localSettings.ai,
                            localModels: { ...localSettings.ai.localModels, embeddings: e.target.value }
                          }
                        })}
                        placeholder="nomic-embed-text"
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Chat Model</label>
                      <input
                        style={styles.input}
                        value={localSettings.ai.localModels.chat}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          ai: {
                            ...localSettings.ai,
                            localModels: { ...localSettings.ai.localModels, chat: e.target.value }
                          }
                        })}
                        placeholder="llama3.2:3b"
                      />
                    </div>
                  </div>

                  <h3 style={styles.subTitle}>Saved Cloud Providers</h3>
                  {localSettings.ai.cloudProviders.map(provider => (
                    <div key={provider.id} style={styles.cloudProviderCard}>
                      <div style={styles.providerHeader}>
                        <strong>{provider.name}</strong>
                        <div>
                          <button
                            style={styles.removeBtn}
                            onClick={() => handleRemoveCloudProvider(provider.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>API Key</label>
                        <input
                          style={styles.input}
                          type="password"
                          value={provider.apiKey || ''}
                          onChange={e => handleUpdateCloudProvider(provider.id, { apiKey: e.target.value })}
                          placeholder="Paste your API key here..."
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Model</label>
                        <select
                          style={styles.select}
                          value={provider.defaultModel}
                          onChange={e => handleUpdateCloudProvider(provider.id, { defaultModel: e.target.value })}
                        >
                          {(availableModels[provider.type] || []).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  <button style={styles.addBtn} onClick={handleAddCloudProvider}>
                    + Add Cloud Provider
                  </button>

                  <div style={styles.infoBox}>
                    <strong>ℹ️ AI Provider Strategy</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}>
                      • <b>Ollama (Local)</b>: Free, private, runs on your machine. Best for privacy.
                      Download from <a href="#" onClick={e => { e.preventDefault(); window.api.app.openExternal('https://ollama.com') }}>ollama.com</a><br />
                      • <b>Groq</b>: Free tier available, fast inference. Get key at <a href="#" onClick={e => { e.preventDefault(); window.api.app.openExternal('https://console.groq.com') }}>console.groq.com</a><br />
                      • <b>OpenAI</b>: Best quality. Get key at <a href="#" onClick={e => { e.preventDefault(); window.api.app.openExternal('https://platform.openai.com/api-keys') }}>platform.openai.com</a><br />
                      • <b>Anthropic</b>: Best for long context. Get key at <a href="#" onClick={e => { e.preventDefault(); window.api.app.openExternal('https://console.anthropic.com') }}>console.anthropic.com</a><br />
                      • Keys are stored locally and never sent anywhere except to the provider API.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'transcription' && (
            <div>
              <h2 style={styles.sectionTitle}>Transcription Settings</h2>
              <div style={styles.card}>
                <div style={styles.field}>
                  <label style={styles.label}>Model Size</label>
                  <select
                    style={styles.select}
                    value={localSettings.transcription.model}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      transcription: { ...localSettings.transcription, model: e.target.value as any }
                    })}
                  >
                    <option value="tiny">Tiny (fast, 39M params)</option>
                    <option value="base">Base (78M params)</option>
                    <option value="small">Small (244M params)</option>
                    <option value="medium">Medium (769M params)</option>
                    <option value="large-v3-turbo">Large v3 Turbo ★ Best balance (809M)</option>
                    <option value="large-v3">Large v3 (most accurate, 1.5B)</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Compute Type</label>
                  <select
                    style={styles.select}
                    value={localSettings.transcription.computeType}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      transcription: { ...localSettings.transcription, computeType: e.target.value as any }
                    })}
                  >
                    <option value="int8_float16">INT8+Float16 (balanced)</option>
                    <option value="int8">INT8 (fast, less accurate)</option>
                    <option value="float16">Float16 (accurate, more VRAM)</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Language (leave empty for auto-detect)</label>
                  <input
                    style={styles.input}
                    value={localSettings.transcription.language || ''}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      transcription: { ...localSettings.transcription, language: e.target.value || undefined }
                    })}
                    placeholder="en, zh, ja, es, fr, de..."
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>ASR Model</label>
                  <select
                    style={styles.select}
                    value={localSettings.transcription.asrModel}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      transcription: { ...localSettings.transcription, asrModel: e.target.value as any }
                    })}
                  >
                    <option value="faster-whisper">faster-whisper (large-v3-turbo) ✓</option>
                    <option value="parakeet-tdt">parakeet-tdt-0.6b (more accurate, slower)</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={localSettings.transcription.useVAD}
                      onChange={e => setLocalSettings({
                        ...localSettings,
                        transcription: { ...localSettings.transcription, useVAD: e.target.checked }
                      })}
                    />
                    <span>Filter non-speech (VAD)</span>
                  </label>
                  <p style={{ margin: '2px 0 0 24px', fontSize: 12, color: '#888' }}>
                    Reduces hallucinations by filtering silence and background noise
                  </p>
                </div>
                <div style={styles.field}>
                  <label style={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={localSettings.transcription.useNoiseReduction}
                      onChange={e => setLocalSettings({
                        ...localSettings,
                        transcription: { ...localSettings.transcription, useNoiseReduction: e.target.checked }
                      })}
                    />
                    <span>Noise reduction</span>
                  </label>
                  <p style={{ margin: '2px 0 0 24px', fontSize: 12, color: '#888' }}>
                    Cleans audio before processing for better accuracy
                  </p>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Context prompt (optional)</label>
                  <textarea
                    style={styles.textarea}
                    value={localSettings.transcription.initialPrompt}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      transcription: { ...localSettings.transcription, initialPrompt: e.target.value }
                    })}
                    placeholder="e.g. This is a business meeting about quarterly results..."
                    rows={3}
                  />
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#888' }}>
                    Helps Whisper understand the meeting context
                  </p>
                </div>
              </div>

              <div style={styles.infoBox}>
                <strong>ℹ️ Model Sizes & Requirements</strong>
                <table style={styles.infoTable}>
                  <thead>
                    <tr><th>Model</th><th>VRAM</th><th>Speed (GPU)</th><th>Accuracy</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>large-v3</td><td>~10 GB</td><td>~1x (1hr audio ~ 4 min)</td><td>Best (8-12% WER meetings)</td></tr>
                    <tr><td>large-v3-turbo</td><td>~6 GB</td><td>~8x (1hr audio ~ 30s)</td><td>Good (10-15%)</td></tr>
                    <tr><td>medium</td><td>~5 GB</td><td>~2x</td><td>Good (10-18%)</td></tr>
                    <tr><td>small</td><td>~2 GB</td><td>~4x</td><td>Fair (15-25%)</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'diarization' && (
            <div>
              <h2 style={styles.sectionTitle}>Speaker Diarization</h2>
              <div style={styles.card}>
                <div style={styles.field}>
                  <label style={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={localSettings.diarization.enabled}
                      onChange={e => setLocalSettings({
                        ...localSettings,
                        diarization: { ...localSettings.diarization, enabled: e.target.checked }
                      })}
                    />
                    <span>Enable speaker identification</span>
                  </label>
                </div>
                {localSettings.diarization.enabled && (
                  <>
                    <div style={styles.field}>
                      <label style={styles.label}>Min Speakers</label>
                      <input
                        style={styles.input}
                        type="number"
                        value={localSettings.diarization.minSpeakers}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          diarization: { ...localSettings.diarization, minSpeakers: Math.max(1, parseInt(e.target.value) || 1) }
                        })}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Max Speakers</label>
                      <input
                        style={styles.input}
                        type="number"
                        min="1"
                        max="50"
                        value={localSettings.diarization.maxSpeakers}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          diarization: { ...localSettings.diarization, maxSpeakers: Math.max(1, parseInt(e.target.value) || 10) }
                        })}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Clustering Threshold</label>
                      <input
                        style={styles.input}
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={localSettings.diarization.clusteringThreshold}
                        onChange={e => setLocalSettings({
                          ...localSettings,
                          diarization: { ...localSettings.diarization, clusteringThreshold: parseFloat(e.target.value) ?? 0.7 }
                        })}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            <div>
              <h2 style={styles.sectionTitle}>Audio Capture</h2>
              <div style={styles.card}>
                <div style={styles.field}>
                  <label style={styles.label}>Sample Rate</label>
                  <select
                    style={styles.select}
                    value={localSettings.audio.sampleRate}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      audio: { ...localSettings.audio, sampleRate: parseInt(e.target.value) }
                    })}
                  >
                    <option value="16000">16000 Hz (recommended)</option>
                    <option value="44100">44100 Hz</option>
                    <option value="48000">48000 Hz</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Format</label>
                  <select
                    style={styles.select}
                    value={localSettings.audio.format}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      audio: { ...localSettings.audio, format: e.target.value as any }
                    })}
                  >
                    <option value="wav">WAV (lossless)</option>
                    <option value="flac">FLAC (compressed)</option>
                    <option value="mp3">MP3 (smallest)</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={localSettings.audio.noiseSuppression}
                      onChange={e => setLocalSettings({
                        ...localSettings,
                        audio: { ...localSettings.audio, noiseSuppression: e.target.checked }
                      })}
                    />
                    <span>Noise suppression</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div>
              <h2 style={styles.sectionTitle}>General</h2>
              <div style={styles.card}>
                <div style={styles.field}>
                  <label style={styles.label}>Theme</label>
                  <select
                    style={styles.select}
                    value={localSettings.ui.theme}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      ui: { ...localSettings.ui, theme: e.target.value as any }
                    })}
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Font Size</label>
                  <input
                    style={styles.input}
                    type="number"
                    min="12"
                    max="24"
                    value={localSettings.ui.fontSize}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      ui: { ...localSettings.ui, fontSize: Math.max(8, parseInt(e.target.value) || 14) }
                    })}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Default Export Format</label>
                  <select
                    style={styles.select}
                    value={localSettings.export.defaultFormat}
                    onChange={e => setLocalSettings({
                      ...localSettings,
                      export: { ...localSettings.export, defaultFormat: e.target.value as any }
                    })}
                  >
                    <option value="markdown">Markdown</option>
                    <option value="txt">Plain Text</option>
                    <option value="json">JSON</option>
                    <option value="srt">SRT</option>
                    <option value="vtt">VTT</option>
                    <option value="docx">DOCX</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f5f5f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  header: { background: '#fff', padding: '12px 24px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 16 },
  backBtn: { padding: '6px 14px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  title: { margin: 0, fontSize: 18, fontWeight: 600, flex: 1 },
  saveBtn: { padding: '8px 20px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  layout: { display: 'flex', height: 'calc(100vh - 55px)' },
  sidebar: { width: 200, background: '#fff', borderRight: '1px solid #e0e0e0', padding: 8, flexShrink: 0 },
  sidebarItem: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, textAlign: 'left', marginBottom: 2 },
  content: { flex: 1, padding: 24, overflowY: 'auto', maxWidth: 800 },
  sectionTitle: { fontSize: 20, fontWeight: 600, marginTop: 0, marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: '#666', marginBottom: 24, lineHeight: 1.5 },
  subTitle: { fontSize: 15, fontWeight: 600, marginTop: 24, marginBottom: 12 },
  card: { background: '#fff', borderRadius: 8, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 16 },
  field: { marginBottom: 12 },
  label: { display: 'block', fontSize: 12, fontWeight: 500, color: '#555', marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
  select: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
  toggle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' },
  providerToggle: { marginBottom: 16 },
  testBtn: { padding: '8px 16px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  testResult: { marginLeft: 12, fontSize: 13 },
  addBtn: { padding: '8px 16px', background: '#e8f5e9', color: '#388e3c', border: '1px solid #c8e6c9', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginTop: 8 },
  cloudProviderCard: { background: '#fafafa', borderRadius: 8, padding: 16, marginBottom: 12, border: '1px solid #eee' },
  providerHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  removeBtn: { padding: '4px 10px', background: '#fee', color: '#c0392b', border: '1px solid #f5c6cb', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  infoBox: { background: '#e8f4fd', borderRadius: 8, padding: 16, marginTop: 24, fontSize: 13, lineHeight: 1.6, border: '1px solid #b6d4fe' },
  infoTable: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 12 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#666' }
}

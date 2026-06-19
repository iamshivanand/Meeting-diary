import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type { Meeting, MeetingSegment, Speaker, AIProvider } from '@shared/types'
import { EnrollModal } from '../components/EnrollModal'
import WaveSurfer from 'wavesurfer.js'

interface Props {
  meetingId: string
  onBack: () => void
}

export function MeetingViewPage({ meetingId, onBack }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null)
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [aiTab, setAiTab] = useState<'summary' | 'actions' | 'decisions' | 'topics' | 'chat'>('summary')
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [enrollModal, setEnrollModal] = useState<{ speakerId: string } | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [allTags, setAllTags] = useState<string[]>([])
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  const waveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(1)

  const formatAudioTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  useEffect(() => {
    if (!waveformRef.current || !meeting?.audioPath) return

    window.api.getAudioUrl(meeting.audioPath).then(audioUrl => {
      if (!waveformRef.current) return

      const ws = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#4f46e5',
        progressColor: '#818cf8',
        cursorColor: '#c7d2fe',
        barWidth: 2,
        barRadius: 3,
        barGap: 2,
        height: 80,
        normalize: true,
      })

      ws.load(audioUrl)

      ws.on('ready', () => {
        setDuration(ws.getDuration())
      })

      ws.on('timeupdate', (time) => {
        setCurrentTime(time)
      })

      ws.on('play', () => setIsPlaying(true))
      ws.on('pause', () => setIsPlaying(false))

      wavesurferRef.current = ws
    })

    return () => {
      wavesurferRef.current?.destroy()
      wavesurferRef.current = null
    }
  }, [meeting?.audioPath])

  const togglePlay = () => {
    wavesurferRef.current?.playPause()
  }

  const changeSpeed = (speed: number) => {
    setPlaybackRate(speed)
    wavesurferRef.current?.setPlaybackRate(speed)
  }

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    wavesurferRef.current?.setVolume(v)
  }

  const loadMeeting = useCallback(async () => {
    setLoading(true)
    const m = await window.api.meetings.get(meetingId)
    setMeeting(m)
    setLoading(false)
  }, [meetingId])

  useEffect(() => { loadMeeting() }, [loadMeeting])

  useEffect(() => {
    window.api.meetings.getAllTags().then(setAllTags).catch(() => {})
  }, [])

  const handleRenameSpeaker = async (speakerId: string, newLabel: string) => {
    if (!meeting) return
    await window.api.speakers.update(meeting.id, speakerId, { label: newLabel })
    await loadMeeting()
  }

  const handleEnrollSpeaker = async (speakerId: string, name: string) => {
    if (!meeting) return
    const speaker = meeting.speakers.find(s => s.id === speakerId)
    if (!speaker) return

    await window.api.speakers.enroll(meeting.id, speakerId, name, [])
    await loadMeeting()
  }

  const handleProcessAI = async (action: string) => {
    if (!meeting) return
    setAiLoading(true)
    try {
      let result: string
      switch (action) {
        case 'summarize':
          result = await window.api.ai.summarize(meeting.id)
          break
        case 'actions':
          result = await window.api.ai.extractActions(meeting.id)
          break
        case 'decisions':
          result = await window.api.ai.extractDecisions(meeting.id)
          break
        case 'topics':
          result = await window.api.ai.segmentTopics(meeting.id)
          break
        default:
          result = 'Unknown action'
      }
      setAiResult(result)
      setAiTab(action as any)
    } catch (err) {
      setAiResult(`Error: ${err}`)
    }
    setAiLoading(false)
  }

  const handleExport = async (format: string) => {
    try {
      const path = await window.api.meetings.export(meetingId, { type: format as any })
      alert(`Exported to: ${path}`)
    } catch (err) {
      alert(`Export failed: ${err}`)
    }
  }

  const handleExportTranscript = async (format: string) => {
    if (!meeting) return
    try {
      const path = await window.api.exportTranscript(meeting, format)
      if (path) alert(`Exported to: ${path}`)
    } catch (err) {
      alert(`Export failed: ${err}`)
    }
    setShowExportMenu(false)
  }

  const handleAddTag = async (tag: string) => {
    if (!meeting) return
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-')
    if (!clean || meeting.tags?.includes(clean)) return
    const newTags = [...(meeting.tags || []), clean]
    await window.api.meetings.updateMeetingTags(meeting.id, newTags)
    setMeeting({ ...meeting, tags: newTags })
    setTagInput('')
    setShowTagSuggestions(false)
    const updated = await window.api.meetings.getAllTags()
    setAllTags(updated)
  }

  const handleRemoveTag = async (tag: string) => {
    if (!meeting) return
    const newTags = (meeting.tags || []).filter(t => t !== tag)
    await window.api.meetings.updateMeetingTags(meeting.id, newTags)
    setMeeting({ ...meeting, tags: newTags })
    const updated = await window.api.meetings.getAllTags()
    setAllTags(updated)
  }

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      handleAddTag(tagInput)
    } else if (e.key === 'Enter' && tagInput.includes(',')) {
      const parts = tagInput.split(',').map(t => t.trim()).filter(Boolean)
      parts.forEach(p => handleAddTag(p))
    }
  }

  useEffect(() => {
    if (!showExportMenu) return
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showExportMenu])

  const suggestedTags = allTags.filter(t => !meeting?.tags?.includes(t))

  if (loading) return <div style={styles.loading}>Loading meeting...</div>
  if (!meeting) return <div style={styles.loading}>Meeting not found</div>

  const getSpeakerName = (speakerId: string) => {
    const speaker = meeting.speakers.find(s => s.id === speakerId)
    return speaker?.label || speaker?.enrolledName || speakerId
  }

  const getSpeakerColor = (speakerId: string) => {
    return meeting.speakers.find(s => s.id === speakerId)?.color || '#999'
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <h1 style={styles.title}>{meeting.title}</h1>
        <div style={styles.headerActions}>
          <select style={styles.exportSelect} onChange={e => handleExport(e.target.value)} defaultValue="">
            <option value="" disabled>Export...</option>
            <option value="markdown">Markdown</option>
            <option value="txt">Plain Text</option>
            <option value="json">JSON</option>
            <option value="srt">SRT</option>
            <option value="vtt">VTT</option>
          </select>
          <div ref={exportRef} style={{ position: 'relative', display: 'inline-block' }}>
            <button style={styles.exportBtn} onClick={() => setShowExportMenu(!showExportMenu)}>
              Export ▼
            </button>
            {showExportMenu && (
              <div style={styles.exportMenu}>
                <div style={styles.exportMenuItem} onClick={() => handleExportTranscript('docx')}>Word (DOCX)</div>
                <div style={styles.exportMenuItem} onClick={() => handleExportTranscript('srt')}>SubRip (SRT)</div>
                <div style={styles.exportMenuItem} onClick={() => handleExportTranscript('md')}>Markdown (MD)</div>
                <div style={styles.exportMenuItem} onClick={() => handleExportTranscript('json')}>JSON</div>
                <div style={styles.exportMenuItem} onClick={() => handleExportTranscript('txt')}>Plain Text</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div style={styles.tagsSection}>
        {(meeting.tags || []).map(tag => (
          <span key={tag} style={styles.tagChip}>
            {tag}
            <button style={styles.tagRemoveBtn} onClick={() => handleRemoveTag(tag)}>×</button>
          </span>
        ))}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <input
            style={styles.tagInput}
            placeholder="Add tag..."
            value={tagInput}
            onChange={e => {
              setTagInput(e.target.value)
              if (e.target.value.includes(',')) {
                const parts = e.target.value.split(',').map(t => t.trim()).filter(Boolean)
                parts.forEach(p => handleAddTag(p))
              } else {
                setShowTagSuggestions(e.target.value.length > 0)
              }
            }}
            onKeyDown={handleTagKeyDown}
            onFocus={() => setShowTagSuggestions(true)}
            onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
          />
          {showTagSuggestions && suggestedTags.filter(t => t.includes(tagInput.toLowerCase())).length > 0 && (
            <div style={styles.tagSuggestions}>
              {suggestedTags.filter(t => t.includes(tagInput.toLowerCase())).map(t => (
                <div key={t} style={styles.tagSuggestionItem} onMouseDown={() => handleAddTag(t)}>
                  {t}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {meeting.audioPath && (
        <div style={styles.playerCard}>
          <div ref={waveformRef} style={styles.waveform} />
          <div style={styles.playerControls}>
            <div style={styles.controlsLeft}>
              <button style={styles.playBtn} onClick={togglePlay}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <span style={styles.timeDisplay}>
                {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
              </span>
              <div style={styles.speedControl}>
                {[0.5, 1, 1.5, 2].map(speed => (
                  <button
                    key={speed}
                    style={{
                      ...styles.speedBtn,
                      background: playbackRate === speed ? '#4f46e5' : 'transparent',
                      color: playbackRate === speed ? '#fff' : '#ccc',
                    }}
                    onClick={() => changeSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
            <div style={styles.volumeControl}>
              <span style={styles.volumeIcon}>{volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={changeVolume}
                style={styles.volumeSlider}
              />
            </div>
          </div>
        </div>
      )}

      {!meeting.audioPath && (
        <div style={styles.noAudio}>No recording available for this meeting.</div>
      )}

      <div style={styles.layout}>
        <aside style={styles.speakerPanel}>
          <h3 style={styles.panelTitle}>Speakers</h3>
          {meeting.speakers.map(speaker => (
            <div key={speaker.id} style={styles.speakerCard}>
              <div style={{ ...styles.speakerDot, background: speaker.color }} />
              <div style={styles.speakerInfo}>
                <input
                  style={styles.speakerNameInput}
                  defaultValue={speaker.label || speaker.enrolledName || speaker.id}
                  onBlur={e => handleRenameSpeaker(speaker.id, e.target.value)}
                  placeholder="Name speaker..."
                />
                <span style={styles.speakerMeta}>
                  {Math.round(speaker.totalDuration)}s · {speaker.segments.length} segments
                  {speaker.enrolledName && <span style={styles.enrolledBadge}> ✓ Enrolled</span>}
                </span>
              </div>
              {!speaker.enrolledName && (
                <button
                  style={styles.enrollBtn}
                  onClick={() => setEnrollModal({ speakerId: speaker.id })}
                  title="Enroll speaker for auto-ID"
                >
                  ID
                </button>
              )}
            </div>
          ))}
        </aside>

        <main style={styles.transcriptArea}>
          <div style={styles.transcriptHeader}>
            <span>{meeting.status === 'completed' ? `${meeting.segments.length} segments` : 'Processing...'}</span>
            {meeting.status === 'recorded' && (
              <button
                style={styles.processBtn}
                onClick={async () => {
                  await window.api.meetings.processRecording(meeting.id)
                  await loadMeeting()
                }}
              >
                Process Now
              </button>
            )}
          </div>

          <div style={styles.segmentsList}>
            {meeting.segments.map(seg => (
              <div
                key={seg.id}
                style={{
                  ...styles.segmentRow,
                  borderLeftColor: getSpeakerColor(seg.speakerId),
                  background: selectedSegment === seg.id ? '#f0f7ff' : '#fff'
                }}
                onClick={() => setSelectedSegment(seg.id)}
              >
                <div style={styles.segmentSpeaker}>
                  <span style={{ ...styles.segmentDot, background: getSpeakerColor(seg.speakerId) }} />
                  <strong style={styles.segmentSpeakerName}>
                    {seg.speakerLabel || getSpeakerName(seg.speakerId)}
                  </strong>
                  <span style={styles.segmentTime}>
                    {formatTime(seg.start)} - {formatTime(seg.end)}
                  </span>
                </div>
                {editingSegmentId === seg.id ? (
                  <div>
                    <textarea
                      style={styles.editTextarea}
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      autoFocus
                    />
                    <div style={styles.editActions}>
                      <button
                        style={styles.saveBtn}
                        onClick={async () => {
                          await window.api.meetings.update(meeting.id, {
                            segments: meeting.segments.map(s => s.id === seg.id ? { ...s, text: editText } : s)
                          })
                          setEditingSegmentId(null)
                          await loadMeeting()
                        }}
                      >
                        Save
                      </button>
                      <button style={styles.cancelEditBtn} onClick={() => setEditingSegmentId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    style={styles.segmentText}
                    onDoubleClick={() => {
                      setEditingSegmentId(seg.id)
                      setEditText(seg.text)
                    }}
                  >
                    {seg.text || '(no audio)'}
                  </p>
                )}
                <span style={styles.confidence}>
                  {Math.round(seg.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        </main>

        <aside style={styles.aiPanel}>
          <h3 style={styles.panelTitle}>AI Analysis</h3>
          <div style={styles.aiTabs}>
            {(['summary', 'actions', 'decisions', 'topics'] as const).map(tab => (
              <button
                key={tab}
                style={{
                  ...styles.aiTab,
                  background: aiTab === tab ? '#3498db' : '#f0f0f0',
                  color: aiTab === tab ? '#fff' : '#333'
                }}
                onClick={() => {
                  setAiTab(tab)
                  if (!aiResult) handleProcessAI(tab)
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div style={styles.aiContent}>
            {aiLoading ? (
              <p>Processing...</p>
            ) : aiResult ? (
              <pre style={styles.aiText}>{aiResult}</pre>
            ) : (
              <div style={styles.aiPlaceholder}>
                <p>Click a tab to analyze this meeting</p>
                <p style={styles.aiNote}>Requires Ollama or a configured AI provider in Settings</p>
              </div>
            )}
          </div>
        </aside>
      </div>
      {enrollModal && (
        <EnrollModal
          speakerId={enrollModal.speakerId}
          currentName={meeting.speakers.find(s => s.id === enrollModal.speakerId)?.label}
          onEnroll={handleEnrollSpeaker}
          onClose={() => setEnrollModal(null)}
        />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f5f5f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  header: { background: '#fff', padding: '12px 24px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 16 },
  backBtn: { padding: '6px 14px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  title: { margin: 0, fontSize: 18, fontWeight: 600, flex: 1 },
  headerActions: { display: 'flex', gap: 8 },
  exportSelect: { padding: '6px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  exportBtn: { padding: '6px 12px', background: '#3498db', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  exportMenu: { position: 'absolute', top: '100%', right: 0, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, minWidth: 160, marginTop: 4 },
  exportMenuItem: { padding: '8px 14px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' },
  layout: { display: 'flex', height: 'calc(100vh - 55px)' },
  speakerPanel: { width: 240, background: '#fff', borderRight: '1px solid #e0e0e0', padding: 16, overflowY: 'auto', flexShrink: 0 },
  panelTitle: { fontSize: 14, fontWeight: 600, marginBottom: 12, marginTop: 0 },
  speakerCard: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f0f0f0' },
  speakerDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  speakerInfo: { flex: 1, minWidth: 0 },
  speakerNameInput: { border: 'none', borderBottom: '1px dashed #ccc', fontSize: 13, padding: '2px 4px', width: '100%', outline: 'none' },
  speakerMeta: { fontSize: 11, color: '#999', display: 'block' },
  enrollBtn: { padding: '2px 8px', background: '#e8f5e9', color: '#388e3c', border: '1px solid #c8e6c9', borderRadius: 4, fontSize: 11, cursor: 'pointer' },
  enrolledBadge: { color: '#27ae60', fontSize: 11, fontWeight: 500 },
  transcriptArea: { flex: 1, overflowY: 'auto', padding: 16 },
  transcriptHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, fontSize: 13, color: '#666' },
  processBtn: { padding: '6px 14px', background: '#3498db', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  segmentsList: { display: 'flex', flexDirection: 'column', gap: 4 },
  segmentRow: { borderLeft: '3px solid #999', padding: '10px 14px', borderRadius: 0, cursor: 'pointer', position: 'relative' },
  segmentSpeaker: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  segmentDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  segmentSpeakerName: { fontSize: 13, fontWeight: 500 },
  segmentTime: { fontSize: 11, color: '#999', marginLeft: 8 },
  segmentText: { margin: 0, fontSize: 14, lineHeight: 1.5, color: '#333' },
  confidence: { position: 'absolute', top: 8, right: 8, fontSize: 10, color: '#bbb' },
  editTextarea: { width: '100%', minHeight: 60, padding: 8, border: '1px solid #3498db', borderRadius: 4, fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
  editActions: { display: 'flex', gap: 6, marginTop: 6 },
  saveBtn: { padding: '4px 12px', background: '#27ae60', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  cancelEditBtn: { padding: '4px 12px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  aiPanel: { width: 320, background: '#fff', borderLeft: '1px solid #e0e0e0', padding: 16, overflowY: 'auto', flexShrink: 0 },
  aiTabs: { display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' },
  aiTab: { padding: '4px 10px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' },
  aiContent: { whiteSpace: 'pre-wrap', overflowY: 'auto', maxHeight: 'calc(100vh - 200px)' },
  aiText: { fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', whiteSpace: 'pre-wrap', margin: 0 },
  aiPlaceholder: { color: '#999', fontSize: 13, textAlign: 'center', padding: 20 },
  aiNote: { fontSize: 11, color: '#bbb', marginTop: 8 },
  tagsSection: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '8px 24px', background: '#fff', borderBottom: '1px solid #e0e0e0' },
  tagChip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', background: '#e8f0fe', color: '#1a73e8', borderRadius: 12, fontSize: 12, fontWeight: 500 },
  tagRemoveBtn: { background: 'none', border: 'none', color: '#1a73e8', cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, opacity: 0.7 },
  tagInput: { padding: '4px 10px', border: '1px solid #ccc', borderRadius: 12, fontSize: 12, outline: 'none', minWidth: 100 },
  tagSuggestions: { position: 'absolute', top: '100%', left: 0, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 150, overflowY: 'auto', minWidth: 120 },
  tagSuggestionItem: { padding: '6px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f0f0f0' },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#666' },
  playerCard: {
    background: '#1e1e2e',
    margin: '12px 24px',
    borderRadius: 10,
    padding: '16px 20px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  },
  waveform: { width: '100%' },
  playerControls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  controlsLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: '2px solid #818cf8',
    background: 'transparent',
    color: '#818cf8',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },
  timeDisplay: { fontSize: 13, color: '#a0a0b8', fontVariantNumeric: 'tabular-nums' },
  speedControl: { display: 'flex', gap: 4 },
  speedBtn: {
    padding: '3px 8px',
    border: '1px solid #3d3d5c',
    borderRadius: 4,
    fontSize: 11,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  volumeControl: { display: 'flex', alignItems: 'center', gap: 6 },
  volumeIcon: { fontSize: 14 },
  volumeSlider: { width: 80, height: 4, accentColor: '#818cf8', cursor: 'pointer' },
  noAudio: {
    margin: '12px 24px',
    padding: '20px',
    background: '#1e1e2e',
    borderRadius: 10,
    textAlign: 'center',
    color: '#888',
    fontSize: 14,
  },
}

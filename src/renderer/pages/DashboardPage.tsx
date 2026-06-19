import React, { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { Meeting, RecordingStatus } from '@shared/types'

interface Props {
  onNavigate: (route: any) => void
}

export function DashboardPage({ onNavigate }: Props) {
  const { meetings, recordingStatus, processingProgress, isLoading, loadMeetings, error } = useAppStore()
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTitle, setRecordingTitle] = useState('')
  const [showNewMeeting, setShowNewMeeting] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadMeetings()
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [loadMeetings])

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 4000)
      return () => clearTimeout(t)
    }
  }, [notification])

  const activeRecordings = meetings.filter(m => m.status === 'recorded' || m.status === 'processing')
  const completedRecordings = meetings.filter(m => m.status === 'completed')
  const failedRecordings = meetings.filter(m => m.status === 'failed')

  const handleStartRecording = async () => {
    try {
      const meeting = await window.api.meetings.create({
        title: recordingTitle || `Meeting ${new Date().toLocaleString()}`,
        duration: 0,
        metadata: { platform: 'unknown' }
      })
      await window.api.meetings.startRecording(meeting.id)
      setIsRecording(true)
      setShowNewMeeting(false)
      setRecordingTitle('')

      intervalRef.current = setInterval(() => {
        useAppStore.getState().loadMeetings()
      }, 2000)
    } catch (err) {
      console.error('Failed to start recording:', err)
      setNotification(`Recording failed: ${err}`)
    }
  }

  const handleStopRecording = async (meetingId: string) => {
    try {
      await window.api.meetings.stopRecording(meetingId)
      setIsRecording(false)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      await loadMeetings()
    } catch (err) {
      console.error('Failed to stop recording:', err)
    }
  }

  const handleDeleteMeeting = async (id: string) => {
    setNotification('Deleting meeting...')
    try {
      await useAppStore.getState().deleteMeeting(id)
      setNotification('Meeting deleted')
    } catch (err) {
      setNotification(`Delete failed: ${err}`)
    }
  }

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString()

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Meeting Recorder</h1>
        <div style={styles.headerActions}>
          <button style={styles.settingsBtn} onClick={() => onNavigate({ page: 'settings' })}>
            Settings
          </button>
        </div>
      </header>

      <div style={styles.statusBar}>
        <span style={{ ...styles.statusDot, background: isRecording ? '#e74c3c' : '#27ae60' }} />
        <span>{isRecording ? 'Recording' : 'Ready'}</span>
        {isRecording && (
          <span style={styles.recordingTime}>
            {formatTime(recordingStatus.duration)}
          </span>
        )}
        {processingProgress && (
          <span style={{
            ...styles.processingInfo,
            color: processingProgress.stage === 'error' ? '#e74c3c' : '#f39c12'
          }}>
            {processingProgress.stage === 'error'
              ? `Error: ${processingProgress.message || 'Processing failed'}`
              : `Processing: ${processingProgress.stage} (${processingProgress.progress}%)`}
          </span>
        )}
      </div>
      {notification && (
        <div style={styles.notification}>{notification}</div>
      )}

      {showNewMeeting && (
        <div style={styles.newMeetingOverlay}>
          <div style={styles.newMeetingCard}>
            <h2>New Recording</h2>
            <input
              style={styles.input}
              placeholder="Meeting title (optional)"
              value={recordingTitle}
              onChange={e => setRecordingTitle(e.target.value)}
              autoFocus
            />
            <div style={styles.cardActions}>
              <button style={styles.cancelBtn} onClick={() => setShowNewMeeting(false)}>Cancel</button>
              <button style={styles.recordBtn} onClick={handleStartRecording}>Start Recording</button>
            </div>
          </div>
        </div>
      )}

      <main style={styles.main}>
        {!isRecording && (
          <button style={styles.newRecordBtn} onClick={() => setShowNewMeeting(true)}>
            + New Recording
          </button>
        )}

        {isRecording && (
          <div style={styles.recordingCard}>
            <h3>Recording in progress...</h3>
            <p>Duration: {formatTime(recordingStatus.duration)}</p>
            <p>Audio level: {Math.round(recordingStatus.audioLevel * 100)}%</p>
            <button style={styles.stopBtn} onClick={() => {
              const active = meetings.find(m => m.status === 'recorded' || m.status === 'processing')
              if (active) handleStopRecording(active.id)
            }}>
              Stop Recording
            </button>
          </div>
        )}

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>
            Recent Meetings ({completedRecordings.length + failedRecordings.length})
          </h2>
          {isLoading && <p>Loading...</p>}
          {!isLoading && meetings.length === 0 && (
            <p style={styles.emptyState}>No meetings yet. Start a recording above!</p>
          )}
          <div style={styles.meetingList}>
            {meetings.map(meeting => (
              <div key={meeting.id} style={styles.meetingCard}>
                <div style={styles.meetingInfo} onClick={() => {
                  if (meeting.status === 'completed') {
                    onNavigate({ page: 'meeting', id: meeting.id })
                  }
                }}>
                  <h3 style={styles.meetingTitle}>{meeting.title}</h3>
                  <div style={styles.meetingMeta}>
                    <span>{formatDate(meeting.createdAt)}</span>
                    <span>{Math.round(meeting.duration)}s</span>
                    <span style={{
                      ...styles.statusBadge,
                      background: meeting.status === 'completed' ? '#27ae60' :
                                  meeting.status === 'processing' ? '#f39c12' :
                                  meeting.status === 'failed' ? '#e74c3c' : '#3498db'
                    }}>
                      {meeting.status}
                    </span>
                    {meeting.status === 'completed' && (
                      <span>{meeting.segments.length} segments</span>
                    )}
                  </div>
                </div>
                <div style={styles.meetingActions}>
                  {meeting.status === 'recorded' && (
                    <button
                      style={styles.actionBtn}
                      onClick={async () => {
                        try {
                          await window.api.meetings.processRecording(meeting.id)
                          await loadMeetings()
                        } catch (err) {
                          console.error('Processing failed:', err)
                        }
                      }}
                    >
                      Process
                    </button>
                  )}
                  <button style={styles.dangerBtn} onClick={() => handleDeleteMeeting(meeting.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#f5f5f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  header: { background: '#fff', padding: '16px 24px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: 20, fontWeight: 600 },
  headerActions: { display: 'flex', gap: 8 },
  settingsBtn: { padding: '6px 16px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  statusBar: { background: '#fff', padding: '8px 24px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#666' },
  statusDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  recordingTime: { fontFamily: 'monospace', fontWeight: 600, marginLeft: 8 },
  processingInfo: { color: '#f39c12', marginLeft: 16 },
  newMeetingOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  newMeetingCard: { background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.15)', width: 400 },
  input: { width: '100%', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, marginTop: 12, boxSizing: 'border-box' },
  cardActions: { display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 20px', background: '#f0f0f0', border: '1px solid #ccc', borderRadius: 6, cursor: 'pointer' },
  recordBtn: { padding: '8px 20px', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' },
  main: { maxWidth: 900, margin: '0 auto', padding: 24 },
  newRecordBtn: { display: 'block', width: '100%', padding: 16, background: '#3498db', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer', marginBottom: 24 },
  recordingCard: { background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', marginBottom: 24, border: '2px solid #e74c3c' },
  stopBtn: { padding: '10px 24px', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', marginTop: 12 },
  notification: { position: 'fixed', top: 16, right: 16, background: '#333', color: '#fff', padding: '10px 20px', borderRadius: 8, zIndex: 2000, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: 600, marginBottom: 16 },
  emptyState: { color: '#999', textAlign: 'center', padding: 40 },
  meetingList: { display: 'flex', flexDirection: 'column', gap: 8 },
  meetingCard: { background: '#fff', borderRadius: 8, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', cursor: 'pointer' },
  meetingInfo: { flex: 1 },
  meetingTitle: { margin: 0, fontSize: 14, fontWeight: 500 },
  meetingMeta: { display: 'flex', gap: 12, fontSize: 12, color: '#666', marginTop: 4, alignItems: 'center' },
  statusBadge: { padding: '2px 8px', borderRadius: 10, color: '#fff', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' },
  meetingActions: { display: 'flex', gap: 6, marginLeft: 12 },
  actionBtn: { padding: '6px 14px', background: '#3498db', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  dangerBtn: { padding: '6px 14px', background: '#fee', color: '#c0392b', border: '1px solid #f5c6cb', borderRadius: 4, cursor: 'pointer', fontSize: 12 }
}

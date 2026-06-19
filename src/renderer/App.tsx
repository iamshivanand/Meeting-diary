import React, { useEffect, useState } from 'react'
import { useAppStore } from './store/appStore'
import { DashboardPage } from './pages/DashboardPage'
import { MeetingViewPage } from './pages/MeetingViewPage'
import { SettingsPage } from './pages/SettingsPage'
import { UpdateNotifier } from './components/UpdateNotifier'

type Route = { page: 'dashboard' } | { page: 'meeting'; id: string } | { page: 'settings' }

function ModelDownloadBanner() {
  const modelDownloadStatus = useAppStore(s => s.modelDownloadStatus)
  const modelDownloadProgress = useAppStore(s => s.modelDownloadProgress)

  if (modelDownloadStatus !== 'downloading') return null

  const pct = modelDownloadProgress?.percent ?? 0
  const message = modelDownloadProgress?.message ?? 'Downloading models...'

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(135deg, #1a73e8, #0d47a1)',
      color: '#fff', padding: '12px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 800, margin: '0 auto' }}>
        <div>
          <strong>Downloading ML Models</strong>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{message}</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{pct}%</div>
      </div>
      <div style={{
        marginTop: 8, height: 4, background: 'rgba(255,255,255,0.25)',
        borderRadius: 2, overflow: 'hidden', maxWidth: 800, marginLeft: 'auto', marginRight: 'auto'
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: '#fff', borderRadius: 2,
          transition: 'width 0.3s ease'
        }} />
      </div>
    </div>
  )
}

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' })
  const loadMeetings = useAppStore(s => s.loadMeetings)
  const loadSettings = useAppStore(s => s.loadSettings)
  const setRecordingStatus = useAppStore(s => s.setRecordingStatus)
  const setProcessingProgress = useAppStore(s => s.setProcessingProgress)
  const setModelDownloadStatus = useAppStore(s => s.setModelDownloadStatus)
  const setModelDownloadProgress = useAppStore(s => s.setModelDownloadProgress)

  useEffect(() => {
    loadMeetings()
    loadSettings()

    const unsubStatus = window.api.recording.onStatusChange(status => {
      setRecordingStatus(status)
    })

    const unsubProgress = window.api.processing.onProgress(progress => {
      setProcessingProgress(progress)
      if (progress.stage === 'complete' || progress.stage === 'error') {
        setTimeout(() => setProcessingProgress(null), 3000)
      }
    })

    const unsubModelProgress = window.api.models.onModelDownloadProgress(progress => {
      setModelDownloadProgress(progress)
      if (progress.stage === 'downloading') {
        setModelDownloadStatus('downloading')
      } else if (progress.stage === 'done') {
        setModelDownloadStatus('done')
        setTimeout(() => {
          setModelDownloadStatus('idle')
          setModelDownloadProgress(null)
        }, 3000)
      } else if (progress.stage === 'error') {
        setModelDownloadStatus('error')
      }
    })

    const unsubShortcut = window.api.onShortcut((action: string) => {
      const state = useAppStore.getState()
      switch (action) {
        case 'toggle-recording': {
          if (state.recordingStatus.state === 'recording') {
            const active = state.meetings.find(m => m.status === 'recorded' || m.status === 'processing')
            if (active) window.api.meetings.stopRecording(active.id)
          } else {
            window.api.meetings.create({ title: `Meeting ${new Date().toLocaleString()}`, duration: 0, metadata: { platform: 'unknown' } }).then((meeting: any) => {
              window.api.meetings.startRecording(meeting.id)
            })
          }
          break
        }
        case 'navigate-dashboard':
          setRoute({ page: 'dashboard' })
          break
        case 'navigate-settings':
          setRoute({ page: 'settings' })
          break
        case 'open-latest-meeting': {
          const sorted = [...state.meetings].filter(m => m.status === 'completed').sort((a, b) => b.createdAt - a.createdAt)
          if (sorted.length > 0) setRoute({ page: 'meeting', id: sorted[0].id })
          break
        }
      }
    })

    return () => {
      unsubStatus()
      unsubProgress()
      unsubModelProgress()
      unsubShortcut()
    }
  }, [])

  return (
    <>
      <ModelDownloadBanner />
      {route.page === 'dashboard' && <DashboardPage onNavigate={setRoute} />}
      {route.page === 'meeting' && <MeetingViewPage meetingId={route.id} onBack={() => setRoute({ page: 'dashboard' })} />}
      {route.page === 'settings' && <SettingsPage onBack={() => setRoute({ page: 'dashboard' })} />}
      <UpdateNotifier />
    </>
  )
}

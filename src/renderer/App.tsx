import React, { useEffect, useState } from 'react'
import { useAppStore } from './store/appStore'
import { DashboardPage } from './pages/DashboardPage'
import { MeetingViewPage } from './pages/MeetingViewPage'
import { SettingsPage } from './pages/SettingsPage'

type Route = { page: 'dashboard' } | { page: 'meeting'; id: string } | { page: 'settings' }

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' })
  const loadMeetings = useAppStore(s => s.loadMeetings)
  const loadSettings = useAppStore(s => s.loadSettings)
  const setRecordingStatus = useAppStore(s => s.setRecordingStatus)
  const setProcessingProgress = useAppStore(s => s.setProcessingProgress)

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

    return () => {
      unsubStatus()
      unsubProgress()
    }
  }, [])

  switch (route.page) {
    case 'dashboard':
      return <DashboardPage onNavigate={setRoute} />
    case 'meeting':
      return <MeetingViewPage meetingId={route.id} onBack={() => setRoute({ page: 'dashboard' })} />
    case 'settings':
      return <SettingsPage onBack={() => setRoute({ page: 'dashboard' })} />
  }
}

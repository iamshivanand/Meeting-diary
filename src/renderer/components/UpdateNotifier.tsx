import React, { useEffect } from 'react'
import { useAppStore } from '../store/appStore'

export function UpdateNotifier() {
  const updateStatus = useAppStore(s => s.updateStatus)
  const updateInfo = useAppStore(s => s.updateInfo)
  const updateProgress = useAppStore(s => s.updateProgress)
  const setUpdateStatus = useAppStore(s => s.setUpdateStatus)
  const setUpdateInfo = useAppStore(s => s.setUpdateInfo)
  const setUpdateProgress = useAppStore(s => s.setUpdateProgress)

  useEffect(() => {
    const unsub = window.api.onUpdateStatus((status: any) => {
      setUpdateStatus(status.status)
      if (status.info) setUpdateInfo(status.info)
      if (status.progress) setUpdateProgress(status.progress)
    })
    return unsub
  }, [])

  if (updateStatus === 'idle' || updateStatus === 'not-available' || updateStatus === 'checking') return null

  const handleDownload = () => {
    window.api.downloadUpdate()
    setUpdateStatus('downloading')
  }

  const handleInstall = () => {
    window.api.installUpdate()
  }

  return (
    <div style={styles.banner}>
      {updateStatus === 'available' && (
        <div style={styles.content}>
          <span style={styles.text}>
            Update available{updateInfo?.version ? ` (v${updateInfo.version})` : ''}
          </span>
          <button style={styles.button} onClick={handleDownload}>Download</button>
        </div>
      )}
      {updateStatus === 'downloading' && updateProgress && (
        <div style={styles.content}>
          <span style={styles.text}>Downloading update...</span>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${updateProgress.percent || 0}%` }} />
          </div>
          <span style={styles.percent}>{Math.round(updateProgress.percent || 0)}%</span>
        </div>
      )}
      {updateStatus === 'downloaded' && (
        <div style={styles.content}>
          <span style={styles.text}>Update downloaded</span>
          <button style={styles.button} onClick={handleInstall}>Install & Restart</button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    background: '#2c3e50', color: '#fff', padding: '8px 16px',
    zIndex: 5000, display: 'flex', alignItems: 'center'
  },
  content: {
    display: 'flex', alignItems: 'center', gap: 12,
    width: '100%', maxWidth: 900, margin: '0 auto'
  },
  text: { fontSize: 13, flex: 1 },
  button: {
    padding: '6px 16px', background: '#3498db', color: '#fff',
    border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  progressBar: {
    flex: 1, height: 6, background: '#555', borderRadius: 3,
    overflow: 'hidden', maxWidth: 200
  },
  progressFill: {
    height: '100%', background: '#3498db', borderRadius: 3,
    transition: 'width 0.3s ease'
  },
  percent: { fontSize: 12, fontFamily: 'monospace', minWidth: 36 }
}

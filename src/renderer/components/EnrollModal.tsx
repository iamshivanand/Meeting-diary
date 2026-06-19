import React, { useState } from 'react'

interface Props {
  speakerId: string
  currentName?: string
  onEnroll: (speakerId: string, name: string) => Promise<void>
  onClose: () => void
}

export function EnrollModal({ speakerId, currentName, onEnroll, onClose }: Props) {
  const [name, setName] = useState(currentName || '')
  const [enrolling, setEnrolling] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) return
    setEnrolling(true)
    try {
      await onEnroll(speakerId, name.trim())
      onClose()
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.title}>Enroll Speaker</h3>
        <p style={styles.desc}>
          Assign a name to this speaker for automatic identification in future meetings.
        </p>
        <input
          style={styles.input}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Enter speaker name..."
          autoFocus
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onClose} disabled={enrolling}>
            Cancel
          </button>
          <button
            style={{ ...styles.enrollBtn, opacity: enrolling || !name.trim() ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={enrolling || !name.trim()}
          >
            {enrolling ? 'Enrolling...' : 'Enroll'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.4)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000
  },
  modal: {
    background: '#fff', borderRadius: 12, padding: 24,
    width: 380, boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
  },
  title: { margin: '0 0 8px', fontSize: 18, fontWeight: 600 },
  desc: { margin: '0 0 16px', fontSize: 13, color: '#666', lineHeight: 1.4 },
  input: {
    width: '100%', padding: '10px 12px', border: '1px solid #ccc',
    borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box',
    marginBottom: 16
  },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  cancelBtn: {
    padding: '8px 16px', background: '#f0f0f0', border: '1px solid #ccc',
    borderRadius: 6, fontSize: 13, cursor: 'pointer'
  },
  enrollBtn: {
    padding: '8px 16px', background: '#27ae60', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer'
  }
}

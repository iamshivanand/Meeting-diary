import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => {
  const mockProcess = {
    on: vi.fn(),
    stdin: { write: vi.fn(), on: vi.fn() },
    stdout: { pipe: vi.fn(), on: vi.fn() },
    stderr: { pipe: vi.fn(), on: vi.fn() },
    kill: vi.fn()
  }
  return {
    spawn: vi.fn(() => ({
      ...mockProcess,
      stdout: { pipe: vi.fn(), on: vi.fn((e: string, cb: Function) => {
        if (e === 'data') setTimeout(() => cb(Buffer.from('READY\n')), 10)
      })},
      stderr: { pipe: vi.fn(), on: vi.fn() }
    })),
    execSync: vi.fn(() => Buffer.from('Python 3.10.0'))
  }
})

vi.mock('fs', () => ({ existsSync: vi.fn(() => true) }))
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    on: vi.fn((e: string, cb: Function) => {
      if (e === 'line') setTimeout(() => cb('READY'), 20)
    })
  }))
}))

describe('SidecarManager', () => {
  let SidecarManager: any

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../src/main/sidecar/SidecarManager')
    SidecarManager = mod.SidecarManager
  })

  it('should create instance with sidecar path', () => {
    const manager = new SidecarManager('/fake/path')
    expect(manager).toBeDefined()
  })

  it('should throw if sidecar server not found', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValueOnce(false)
    const manager = new SidecarManager('/nonexistent')
    await expect(manager.start()).rejects.toThrow('Sidecar server not found')
  })

  it('should emit events', () => {
    const manager = new SidecarManager('/fake/path')
    const events: string[] = []
    manager.on('log', () => events.push('log'))
    manager.on('progress', () => events.push('progress'))
    manager.emit('log', { level: 'info', message: 'test' })
    manager.emit('progress', { stage: 'vad', progress: 10, message: 'test' })
    expect(events).toContain('log')
    expect(events).toContain('progress')
  })

  it('should handle stop gracefully when not started', async () => {
    const manager = new SidecarManager('/fake/path')
    await manager.stop()
  })
})

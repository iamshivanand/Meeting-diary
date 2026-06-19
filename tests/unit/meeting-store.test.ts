import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'

describe('MeetingStore', () => {
  let MeetingStore: any
  let store: any
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'meeting-test-'))
    const mod = await import('../../src/main/store/MeetingStore')
    MeetingStore = mod.MeetingStore
    store = new MeetingStore(tmpDir)
  })

  afterEach(() => {
    if (store) store.close()
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should create a meeting', async () => {
    const meeting = await store.createMeeting({ title: 'Test Meeting', duration: 0 })
    expect(meeting.id).toBeDefined()
    expect(meeting.title).toBe('Test Meeting')
    expect(meeting.status).toBe('recorded')
    expect(Array.isArray(meeting.segments)).toBe(true)
    expect(Array.isArray(meeting.speakers)).toBe(true)
  })

  it('should list meetings in reverse chronological order', async () => {
    const m1 = await store.createMeeting({ title: 'Meeting 1' })
    const m2 = await store.createMeeting({ title: 'Meeting 2' })
    const meetings = await store.listMeetings()
    expect(meetings.length).toBe(2)
    expect(meetings[0].title).toBe('Meeting 2')
    expect(meetings[1].title).toBe('Meeting 1')
  })

  it('should get a meeting by id', async () => {
    const created = await store.createMeeting({ title: 'Test' })
    const found = await store.getMeeting(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
  })

  it('should return null for non-existent meeting', async () => {
    const found = await store.getMeeting('nonexistent')
    expect(found).toBeNull()
  })

  it('should update a meeting', async () => {
    const meeting = await store.createMeeting({ title: 'Original' })
    await store.updateMeeting(meeting.id, { title: 'Updated', status: 'completed' })
    const updated = await store.getMeeting(meeting.id)
    expect(updated!.title).toBe('Updated')
    expect(updated!.status).toBe('completed')
  })

  it('should delete a meeting', async () => {
    const meeting = await store.createMeeting({ title: 'To Delete' })
    await store.deleteMeeting(meeting.id)
    const found = await store.getMeeting(meeting.id)
    expect(found).toBeNull()
  })

  it('should replace segments', async () => {
    const meeting = await store.createMeeting({ title: 'Segments Test' })
    const segments = [
      { id: 'seg1', speakerId: 'spk1', text: 'Hello', start: 0, end: 2, confidence: 0.95 },
      { id: 'seg2', speakerId: 'spk2', text: 'World', start: 2, end: 4, confidence: 0.9 }
    ]
    await store.replaceSegments(meeting.id, segments)
    const updated = await store.getMeeting(meeting.id)
    expect(updated!.segments.length).toBe(2)
    expect(updated!.segments[0].text).toBe('Hello')
    expect(updated!.segments[1].speakerId).toBe('spk2')
  })

  it('should replace speakers', async () => {
    const meeting = await store.createMeeting({ title: 'Speakers Test' })
    const speakers = [
      { id: 'spk1', color: '#FF0000', segments: ['seg1'], totalDuration: 10 },
      { id: 'spk2', color: '#00FF00', segments: ['seg2'], totalDuration: 5 }
    ]
    await store.replaceSpeakers(meeting.id, speakers)
    const updated = await store.getMeeting(meeting.id)
    expect(updated!.speakers.length).toBe(2)
    expect(updated!.speakers[0].color).toBe('#FF0000')
  })

  it('should save AI results', async () => {
    const meeting = await store.createMeeting({ title: 'AI Test' })
    await store.saveAIResults(meeting.id, { summary: 'Meeting summary here', actionItems: [], decisions: [] })
    const updated = await store.getMeeting(meeting.id)
    expect(updated!.aiResults?.summary).toBe('Meeting summary here')
  })

  it('should persist meetings to database', async () => {
    const meeting = await store.createMeeting({ title: 'Persistent' })
    store.close()

    const store2 = new MeetingStore(tmpDir)
    const found = await store2.getMeeting(meeting.id)
    expect(found).not.toBeNull()
    expect(found!.title).toBe('Persistent')
    store2.close()
  })
})

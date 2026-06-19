import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import type { Meeting, MeetingSegment, Speaker, MeetingMetadata, ActionItem, Decision, TopicSegment, ChatMessage, SearchResult } from '../../shared/types'

export class MeetingStore {
  private db: SqlJsDatabase | null = null
  private dbPath: string

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
    this.dbPath = join(dataDir, 'meetings.db')
  }

  private async ensureDb(): Promise<SqlJsDatabase> {
    if (this.db) return this.db

    const SQL = await initSqlJs()
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath)
      this.db = new SQL.Database(buffer)
    } else {
      this.db = new SQL.Database()
    }

    this.db.run('PRAGMA foreign_keys = ON')
    this.initializeTables()
    return this.db
  }

  private initializeTables(): void {
    if (!this.db) return
    this.db.run(`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        duration REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'recorded',
        audio_path TEXT,
        transcript_path TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL,
        speaker_label TEXT,
        text TEXT NOT NULL DEFAULT '',
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.0,
        words TEXT,
        embedding BLOB,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS speakers (
        id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        label TEXT,
        color TEXT NOT NULL,
        segments TEXT NOT NULL DEFAULT '[]',
        total_duration REAL NOT NULL DEFAULT 0.0,
        embedding BLOB,
        enrolled_name TEXT,
        enrolled_at INTEGER,
        PRIMARY KEY (id, meeting_id),
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS speaker_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        embeddings BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 1
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ai_results (
        meeting_id TEXT PRIMARY KEY,
        summary TEXT,
        action_items TEXT,
        decisions TEXT,
        topics TEXT,
        chat_history TEXT,
        FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
      )
    `)
    this.db.run('CREATE INDEX IF NOT EXISTS idx_segments_meeting ON segments(meeting_id)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_segments_speaker ON segments(speaker_id)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_speakers_meeting ON speakers(meeting_id)')
    const cols = this.db.exec("PRAGMA table_info('meetings')")[0]?.values.map(v => v[1]) || []
    if (!cols.includes('tags')) {
      this.db.run("ALTER TABLE meetings ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
    }
    this.save()
  }

  private save(): void {
    if (!this.db) return
    const data = this.db.export()
    const buffer = Buffer.from(data)
    writeFileSync(this.dbPath, buffer)
  }

  async createMeeting(data: Partial<Meeting>): Promise<Meeting> {
    const db = await this.ensureDb()
    const id = uuid()
    const now = Date.now()
    const metadata: MeetingMetadata = data.metadata || {}

    db.run(
      'INSERT INTO meetings (id, title, created_at, updated_at, duration, status, audio_path, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, data.title || 'Untitled Meeting', now, now, data.duration || 0, 'recorded', data.audioPath || null, JSON.stringify(metadata)]
    )
    this.save()
    return (await this.getMeeting(id))!
  }

  async getMeeting(id: string): Promise<Meeting | null> {
    const db = await this.ensureDb()
    const stmt = db.prepare('SELECT * FROM meetings WHERE id = ?')
    stmt.bind([id])
    if (!stmt.step()) { stmt.free(); return null }
    const meeting = stmt.getAsObject() as Record<string, unknown>
    stmt.free()

    const segStmt = db.prepare('SELECT * FROM segments WHERE meeting_id = ? ORDER BY start_time')
    segStmt.bind([id])
    const segments: Record<string, unknown>[] = []
    while (segStmt.step()) segments.push(segStmt.getAsObject() as Record<string, unknown>)
    segStmt.free()

    const spkStmt = db.prepare('SELECT * FROM speakers WHERE meeting_id = ?')
    spkStmt.bind([id])
    const speakers: Record<string, unknown>[] = []
    while (spkStmt.step()) speakers.push(spkStmt.getAsObject() as Record<string, unknown>)
    spkStmt.free()

    const aiStmt = db.prepare('SELECT * FROM ai_results WHERE meeting_id = ?')
    aiStmt.bind([id])
    let aiResults: Record<string, unknown> | undefined
    if (aiStmt.step()) aiResults = aiStmt.getAsObject() as Record<string, unknown>
    aiStmt.free()

    return this.rowToMeeting(meeting, segments, speakers, aiResults)
  }

  async listMeetings(): Promise<Meeting[]> {
    const db = await this.ensureDb()
    const stmt = db.prepare('SELECT * FROM meetings ORDER BY created_at DESC')
    const meetings: Record<string, unknown>[] = []
    while (stmt.step()) meetings.push(stmt.getAsObject() as Record<string, unknown>)
    stmt.free()

    const results: Meeting[] = []
    for (const m of meetings) {
      const segStmt = db.prepare('SELECT * FROM segments WHERE meeting_id = ? ORDER BY start_time')
      segStmt.bind([m.id as string])
      const segments: Record<string, unknown>[] = []
      while (segStmt.step()) segments.push(segStmt.getAsObject() as Record<string, unknown>)
      segStmt.free()

      const spkStmt = db.prepare('SELECT * FROM speakers WHERE meeting_id = ?')
      spkStmt.bind([m.id as string])
      const speakers: Record<string, unknown>[] = []
      while (spkStmt.step()) speakers.push(spkStmt.getAsObject() as Record<string, unknown>)
      spkStmt.free()

      results.push(this.rowToMeeting(m, segments, speakers))
    }
    return results
  }

  async updateMeeting(id: string, data: Partial<Meeting>): Promise<void> {
    const db = await this.ensureDb()
    const fields: string[] = []
    const values: unknown[] = []

    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.duration !== undefined) { fields.push('duration = ?'); values.push(data.duration) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status) }
    if (data.audioPath !== undefined) { fields.push('audio_path = ?'); values.push(data.audioPath) }
    if (data.transcriptPath !== undefined) { fields.push('transcript_path = ?'); values.push(data.transcriptPath) }
    if (data.metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(data.metadata)) }
    if (data.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(data.tags)) }
    fields.push('updated_at = ?'); values.push(Date.now())
    values.push(id)

    db.run(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`, values as any[])
    this.save()
  }

  async updateMeetingTags(id: string, tags: string[]): Promise<void> {
    return this.updateMeeting(id, { tags })
  }

  async getAllTags(): Promise<string[]> {
    const meetings = await this.listMeetings()
    const tagSet = new Set<string>()
    for (const m of meetings) {
      if (m.tags) m.tags.forEach(t => tagSet.add(t))
    }
    return Array.from(tagSet).sort()
  }

  async getMeetingsByTag(tag: string): Promise<Meeting[]> {
    const meetings = await this.listMeetings()
    return meetings.filter(m => m.tags?.includes(tag))
  }

  async deleteMeeting(id: string): Promise<void> {
    const db = await this.ensureDb()
    db.run('DELETE FROM segments WHERE meeting_id = ?', [id])
    db.run('DELETE FROM speakers WHERE meeting_id = ?', [id])
    db.run('DELETE FROM ai_results WHERE meeting_id = ?', [id])
    db.run('DELETE FROM meetings WHERE id = ?', [id])
    this.save()
  }

  async replaceSegments(meetingId: string, segments: MeetingSegment[]): Promise<void> {
    const db = await this.ensureDb()
    db.run('DELETE FROM segments WHERE meeting_id = ?', [meetingId])
    const insert = db.prepare('INSERT INTO segments (id, meeting_id, speaker_id, speaker_label, text, start_time, end_time, confidence, words, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const seg of segments) {
      insert.bind([seg.id, meetingId, seg.speakerId, seg.speakerLabel || null, seg.text, seg.start, seg.end, seg.confidence,
        seg.words ? JSON.stringify(seg.words) : null, seg.embedding ? Buffer.from(Float64Array.from(seg.embedding).buffer) : null])
      insert.step()
      insert.reset()
    }
    insert.free()
    this.save()
  }

  async replaceSpeakers(meetingId: string, speakers: Speaker[]): Promise<void> {
    const db = await this.ensureDb()
    db.run('DELETE FROM speakers WHERE meeting_id = ?', [meetingId])
    const insert = db.prepare('INSERT INTO speakers (id, meeting_id, label, color, segments, total_duration, embedding, enrolled_name, enrolled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const spk of speakers) {
      insert.bind([spk.id, meetingId, spk.label || null, spk.color,
        JSON.stringify(spk.segments), spk.totalDuration,
        spk.embedding ? Buffer.from(Float64Array.from(spk.embedding).buffer) : null,
        spk.enrolledName || null, spk.enrolledAt || null])
      insert.step()
      insert.reset()
    }
    insert.free()
    this.save()
  }

  async updateSegment(meetingId: string, segmentId: string, data: Partial<MeetingSegment>): Promise<void> {
    const db = await this.ensureDb()
    const fields: string[] = []
    const values: unknown[] = []
    if (data.speakerLabel !== undefined) { fields.push('speaker_label = ?'); values.push(data.speakerLabel) }
    if (data.text !== undefined) { fields.push('text = ?'); values.push(data.text) }
    if (data.confidence !== undefined) { fields.push('confidence = ?'); values.push(data.confidence) }
    values.push(segmentId)
    values.push(meetingId)
    db.run(`UPDATE segments SET ${fields.join(', ')} WHERE id = ? AND meeting_id = ?`, values as any[])
    this.save()
  }

  async updateSpeaker(meetingId: string, speakerId: string, data: Partial<Speaker>): Promise<void> {
    const db = await this.ensureDb()
    const fields: string[] = []
    const values: unknown[] = []
    if (data.label !== undefined) { fields.push('label = ?'); values.push(data.label) }
    if (data.enrolledName !== undefined) { fields.push('enrolled_name = ?'); values.push(data.enrolledName) }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color) }
    values.push(speakerId)
    values.push(meetingId)
    db.run(`UPDATE speakers SET ${fields.join(', ')} WHERE id = ? AND meeting_id = ?`, values as any[])
    this.save()
  }

  async saveAIResults(meetingId: string, results: {
    summary?: string
    actionItems?: ActionItem[]
    decisions?: Decision[]
    topics?: TopicSegment[]
    chatHistory?: ChatMessage[]
  }): Promise<void> {
    const db = await this.ensureDb()
    const existing = db.prepare('SELECT summary, action_items, decisions, topics, chat_history FROM ai_results WHERE meeting_id = ?')
    existing.bind([meetingId])
    let hasExisting = false
    if (existing.step()) hasExisting = true
    existing.free()

    if (hasExisting) {
      db.run(`UPDATE ai_results SET 
        summary = COALESCE(?, summary),
        action_items = COALESCE(?, action_items),
        decisions = COALESCE(?, decisions),
        topics = COALESCE(?, topics),
        chat_history = COALESCE(?, chat_history)
        WHERE meeting_id = ?`, [
        results.summary || null,
        results.actionItems ? JSON.stringify(results.actionItems) : null,
        results.decisions ? JSON.stringify(results.decisions) : null,
        results.topics ? JSON.stringify(results.topics) : null,
        results.chatHistory ? JSON.stringify(results.chatHistory) : null,
        meetingId
      ])
    } else {
      db.run('INSERT INTO ai_results (meeting_id, summary, action_items, decisions, topics, chat_history) VALUES (?, ?, ?, ?, ?, ?)', [
        meetingId, results.summary || null,
        results.actionItems ? JSON.stringify(results.actionItems) : null,
        results.decisions ? JSON.stringify(results.decisions) : null,
        results.topics ? JSON.stringify(results.topics) : null,
        results.chatHistory ? JSON.stringify(results.chatHistory) : null
      ])
    }
    this.save()
  }

  async getSpeakerRegistry(): Promise<Array<{ id: string; name: string; sampleCount: number; createdAt: number }>> {
    const db = await this.ensureDb()
    const stmt = db.prepare('SELECT id, name, sample_count as sampleCount, created_at as createdAt FROM speaker_registry ORDER BY name')
    const results: Array<{ id: string; name: string; sampleCount: number; createdAt: number }> = []
    while (stmt.step()) results.push(stmt.getAsObject() as any)
    stmt.free()
    return results
  }

  async addSpeakerProfile(name: string, embeddings: number[][]): Promise<string> {
    const db = await this.ensureDb()
    const id = uuid()
    const now = Date.now()
    const buf = Buffer.concat(embeddings.map(e => Buffer.from(Float64Array.from(e).buffer)))
    db.run('INSERT INTO speaker_registry (id, name, embeddings, created_at, updated_at, sample_count) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, buf, now, now, embeddings.length])
    this.save()
    return id
  }

  private rowToMeeting(meeting: Record<string, unknown>, segments: Record<string, unknown>[], speakers: Record<string, unknown>[], aiResults?: Record<string, unknown>): Meeting {
    return {
      id: meeting.id as string,
      title: meeting.title as string,
      createdAt: meeting.created_at as number,
      updatedAt: meeting.updated_at as number,
      duration: meeting.duration as number,
      status: meeting.status as Meeting['status'],
      audioPath: meeting.audio_path as string | undefined,
      transcriptPath: meeting.transcript_path as string | undefined,
      tags: meeting.tags ? JSON.parse(meeting.tags as string) as string[] : undefined,
      metadata: JSON.parse(meeting.metadata as string || '{}') as MeetingMetadata,
      segments: segments.map(s => ({
        id: s.id as string,
        speakerId: s.speaker_id as string,
        speakerLabel: s.speaker_label as string | undefined,
        text: s.text as string,
        start: s.start_time as number,
        end: s.end_time as number,
        confidence: s.confidence as number,
        words: s.words ? JSON.parse(s.words as string) : undefined
      })),
      speakers: speakers.map(s => ({
        id: s.id as string,
        label: s.label as string | undefined,
        color: s.color as string,
        segments: JSON.parse(s.segments as string || '[]'),
        totalDuration: s.total_duration as number,
        enrolledName: s.enrolled_name as string | undefined,
        enrolledAt: s.enrolled_at as number | undefined
      })),
      aiResults: aiResults ? {
        summary: aiResults.summary as string | undefined,
        actionItems: aiResults.action_items ? JSON.parse(aiResults.action_items as string) as ActionItem[] : undefined,
        decisions: aiResults.decisions ? JSON.parse(aiResults.decisions as string) as Decision[] : undefined,
        topics: aiResults.topics ? JSON.parse(aiResults.topics as string) as TopicSegment[] : undefined,
        chatHistory: aiResults.chat_history ? JSON.parse(aiResults.chat_history as string) as ChatMessage[] : undefined
      } : undefined
    }
  }

  async searchTranscripts(query: string, limit: number = 50): Promise<SearchResult[]> {
    const db = await this.ensureDb()
    const escaped = query.replace(/[\\%_]/g, '\\$&')
    const stmt = db.prepare(`
      SELECT m.id, m.title, m.created_at,
             s.id as segment_id, s.speaker_id, s.speaker_label, s.text, s.start_time, s.end_time
      FROM meetings m
      JOIN segments s ON s.meeting_id = m.id
      WHERE s.text LIKE ? ESCAPE '\\'
      ORDER BY m.created_at DESC
      LIMIT ?
    `)
    stmt.bind([`%${escaped}%`, limit])
    const results: SearchResult[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>
      results.push({
        meetingId: row.id as string,
        meetingTitle: row.title as string,
        meetingDate: new Date(row.created_at as number).toISOString(),
        segmentIndex: results.length,
        speaker: (row.speaker_label as string) || (row.speaker_id as string) || 'Unknown',
        text: row.text as string,
        start: row.start_time as number,
        end: row.end_time as number,
      })
    }
    stmt.free()
    return results
  }

  async getAllMeetingTitles(): Promise<Array<{ id: string; title: string; date: string }>> {
    const db = await this.ensureDb()
    const stmt = db.prepare('SELECT id, title, created_at FROM meetings ORDER BY created_at DESC')
    const results: Array<{ id: string; title: string; date: string }> = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>
      results.push({
        id: row.id as string,
        title: row.title as string,
        date: new Date(row.created_at as number).toISOString(),
      })
    }
    stmt.free()
    return results
  }

  close(): void {
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }
}

"""Unit tests for the meeting processor pipeline."""

import sys
import os
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from meeting_processor.pipeline import MeetingProcessor, Segment, SpeakerInfo, MeetingResult


class TestSegment:
    def test_segment_creation(self):
        seg = Segment(
            id="test-1", speaker_id="SPEAKER_00", speaker_label=None,
            text="Hello world", start=0.0, end=5.0, confidence=0.95,
            words=None, embedding=None
        )
        assert seg.id == "test-1"
        assert seg.speaker_id == "SPEAKER_00"
        assert seg.text == "Hello world"

    def test_segment_with_words(self):
        words = [{"word": "Hello", "start": 0.0, "end": 0.5, "confidence": 0.9}]
        seg = Segment(
            id="test-2", speaker_id="SPEAKER_01", speaker_label="John",
            text="Hello", start=0.0, end=0.5, confidence=0.9,
            words=words, embedding=None
        )
        assert seg.speaker_label == "John"
        assert len(seg.words) == 1
        assert seg.words[0]["word"] == "Hello"

    def test_segment_with_embedding(self):
        seg = Segment(
            id="test-3", speaker_id="SPEAKER_00", speaker_label=None,
            text="Test", start=0.0, end=1.0, confidence=0.8,
            words=None, embedding=[0.1, 0.2, 0.3]
        )
        assert len(seg.embedding) == 3
        assert seg.embedding[0] == 0.1


class TestSpeakerInfo:
    def test_speaker_creation(self):
        spk = SpeakerInfo(
            id="SPEAKER_00", label="John", color="#4A90D9",
            segments=["seg-1", "seg-2"], total_duration=10.0,
            enrolled_name="John Smith", enrolled_at=1234567890
        )
        assert spk.id == "SPEAKER_00"
        assert spk.label == "John"
        assert spk.enrolled_name == "John Smith"

    def test_speaker_defaults(self):
        spk = SpeakerInfo(
            id="SPEAKER_00", label=None, color="#4A90D9",
            segments=[], total_duration=0.0
        )
        assert spk.label is None
        assert spk.enrolled_name is None


class TestMeetingResult:
    def test_result_creation(self):
        result = MeetingResult(
            segments=[], speakers=[],
            metadata={"language": "en", "duration": 100.0}
        )
        assert result.metadata["language"] == "en"
        assert len(result.segments) == 0
        assert len(result.speakers) == 0

    def test_result_with_data(self):
        seg = Segment(id="s1", speaker_id="SPK", speaker_label=None,
                      text="Hi", start=0.0, end=1.0, confidence=0.9,
                      words=None, embedding=None)
        spk = SpeakerInfo(id="SPK", label="Alice", color="#FF0000",
                          segments=["s1"], total_duration=1.0)
        result = MeetingResult(
            segments=[seg], speakers=[spk],
            metadata={"language": "en"}
        )
        assert len(result.segments) == 1
        assert result.segments[0].text == "Hi"
        assert result.speakers[0].label == "Alice"


class TestMeetingProcessor:
    def test_initialization(self):
        processor = MeetingProcessor()
        assert processor.transcriber is None
        assert processor.diarizer is None

    def test_detect_device(self):
        pytest.importorskip("torch")
        processor = MeetingProcessor()
        device = processor._detect_device("auto")
        assert device in ("cuda", "cpu")
        assert processor._detect_device("cuda") == "cuda"
        assert processor._detect_device("cpu") == "cpu"

    def test_merge_near_segments(self):
        processor = MeetingProcessor()
        segments = [
            {"speaker": "A", "start": 0.0, "end": 5.0},
            {"speaker": "A", "start": 5.5, "end": 10.0},
            {"speaker": "B", "start": 10.0, "end": 15.0},
            {"speaker": "B", "start": 15.2, "end": 20.0},
        ]
        merged = processor._merge_near_segments(segments, gap=0.5)
        assert len(merged) == 2
        assert merged[0]["speaker"] == "A"
        assert merged[0]["end"] == 10.0
        assert merged[1]["speaker"] == "B"

    def test_merge_near_segments_exceeds_gap(self):
        processor = MeetingProcessor()
        segments = [
            {"speaker": "A", "start": 0.0, "end": 5.0},
            {"speaker": "A", "start": 6.0, "end": 10.0},
        ]
        merged = processor._merge_near_segments(segments, gap=0.5)
        assert len(merged) == 2

    def test_merge_near_segments_empty(self):
        processor = MeetingProcessor()
        assert processor._merge_near_segments([]) == []

    def test_merge_near_segments_single(self):
        processor = MeetingProcessor()
        result = processor._merge_near_segments([{"speaker": "A", "start": 0, "end": 5}])
        assert len(result) == 1

    def test_calc_overlap(self):
        processor = MeetingProcessor()
        assert processor._calc_overlap({"start": 0.0, "end": 10.0}, {"start": 5.0, "end": 15.0}) == 5.0

    def test_calc_no_overlap(self):
        processor = MeetingProcessor()
        assert processor._calc_overlap({"start": 0.0, "end": 5.0}, {"start": 5.0, "end": 10.0}) == 0.0

    def test_calc_complete_overlap(self):
        processor = MeetingProcessor()
        assert processor._calc_overlap({"start": 2.0, "end": 8.0}, {"start": 0.0, "end": 10.0}) == 6.0

    def test_calc_reverse_overlap(self):
        processor = MeetingProcessor()
        assert processor._calc_overlap({"start": 0.0, "end": 10.0}, {"start": 2.0, "end": 8.0}) == 6.0

    def test_merge_pipelines_no_diarization(self):
        processor = MeetingProcessor()
        trans = [{"id": "t1", "start": 0.0, "end": 5.0, "text": "Hello", "confidence": 0.9}]
        merged = processor._merge_pipelines(trans, [])
        assert len(merged) == 1
        assert merged[0]["speaker_id"] == "SPEAKER_00"

    def test_merge_pipelines_no_transcription(self):
        processor = MeetingProcessor()
        diar = [{"speaker": "A", "start": 0.0, "end": 5.0}]
        merged = processor._merge_pipelines([], diar)
        assert len(merged) == 1
        assert merged[0]["speaker_id"] == "A"

    def test_merge_pipelines_with_diarization(self):
        processor = MeetingProcessor()
        trans = [
            {"id": "t1", "start": 0.0, "end": 4.0, "text": "Hello", "confidence": 0.9},
            {"id": "t2", "start": 5.0, "end": 10.0, "text": "World", "confidence": 0.85},
        ]
        diar = [
            {"speaker": "A", "start": 0.0, "end": 5.0},
            {"speaker": "B", "start": 5.0, "end": 10.0},
        ]
        merged = processor._merge_pipelines(trans, diar)
        assert len(merged) == 2
        assert merged[0]["speaker_id"] == "A"
        assert merged[1]["speaker_id"] == "B"
        assert merged[0]["text"] == "Hello"

    def test_default_progress(self, capsys):
        MeetingProcessor._default_progress({"stage": "test", "progress": 50, "message": "testing"})
        captured = capsys.readouterr()
        assert "test" in captured.out

    def test_report_progress_callback(self):
        captured = {"data": None}
        def callback(d):
            captured["data"] = d
        processor = MeetingProcessor(progress_callback=callback)
        processor._report_progress("test", 50, "testing")
        assert captured["data"] is not None
        assert captured["data"]["stage"] == "test"
        assert captured["data"]["progress"] == 50

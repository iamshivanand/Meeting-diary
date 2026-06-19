"""Accuracy benchmarks for the transcription and diarization pipeline.
Requires GPU and ground-truth audio files."""

import sys
import json
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest


def pytest_addoption(parser):
    parser.addoption("--benchmark-json", action="store", default=None,
                     help="Path to write benchmark results JSON")


@pytest.mark.skip(reason="Requires ground-truth audio fixtures")
class TestAccuracyBenchmarks:
    """Benchmark accuracy of transcription + diarization pipeline.
    
    To run: pytest sidecar/tests/benchmarks.py -v --benchmark-json=reports/accuracy.json
    Requires:
      - GPU (CUDA)
      - Ground-truth audio files in tests/fixtures/
      - Reference transcripts in tests/fixtures/references/
    """

    FIXTURES_DIR = Path(__file__).parent / "fixtures"
    RESULTS = {}

    @pytest.mark.parametrize("audio_file", [
        "meeting_2speakers_clean.wav",
        "meeting_3speakers_noisy.wav",
        "meeting_4speakers_overlap.wav",
        "zoom_meeting_2speakers.wav",
        "google_meet_3speakers.wav",
    ])
    def test_transcription_wer(self, audio_file, request):
        """Measure Word Error Rate against reference transcript."""
        audio_path = self.FIXTURES_DIR / audio_file
        ref_path = self.FIXTURES_DIR / "references" / f"{Path(audio_file).stem}.txt"
        
        if not audio_path.exists() or not ref_path.exists():
            pytest.skip(f"Missing fixture: {audio_file}")
        
        from jiwer import wer
        
        if request.config.getoption("--benchmark-json"):
            # Run actual inference and compute WER
            from meeting_processor.pipeline import MeetingProcessor
            
            processor = MeetingProcessor()
            processor.initialize(model_size="large-v3-turbo", device="cuda")
            result = processor.process(str(audio_path))
            
            hypothesis = " ".join(s.text for s in result.segments)
            with open(ref_path) as f:
                reference = f.read()
            
            word_error_rate = wer(reference, hypothesis)
            num_speakers = len(set(s.speaker_id for s in result.segments))
            
            self.RESULTS[audio_file] = {
                "wer": word_error_rate,
                "num_speakers": num_speakers,
                "num_segments": len(result.segments),
                "duration": result.metadata.get("duration", 0),
                "model": "large-v3-turbo"
            }

    @pytest.mark.parametrize("audio_file", [
        "meeting_2speakers_clean.wav",
        "meeting_3speakers_noisy.wav",
    ])
    def test_diarization_der(self, audio_file, request):
        """Measure Diarization Error Rate against reference diarization."""
        audio_path = self.FIXTURES_DIR / audio_file
        ref_path = self.FIXTURES_DIR / "references" / f"{Path(audio_file).stem}_diarization.rttm"
        
        if not audio_path.exists() or not ref_path.exists():
            pytest.skip(f"Missing fixture: {audio_file}")
        
        if request.config.getoption("--benchmark-json"):
            from meeting_processor.pipeline import MeetingProcessor
            from pyannote.core import Annotation
            from pyannote.metrics.diarization import DiarizationErrorRate
            
            processor = MeetingProcessor()
            processor.initialize(model_size="large-v3-turbo", device="cuda")
            result = processor.process(str(audio_path))
            
            # Build reference annotation from RTTM
            reference = Annotation()
            with open(ref_path) as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 7:
                        from pyannote.core import Segment
                        start = float(parts[3])
                        duration = float(parts[4])
                        speaker = parts[7]
                        reference[Segment(start, start + duration)] = speaker
            
            # Build hypothesis annotation
            hypothesis = Annotation()
            for seg in result.segments:
                from pyannote.core import Segment
                hypothesis[Segment(seg.start, seg.end)] = seg.speaker_id
            
            metric = DiarizationErrorRate(skip_overlap=False, collar=0.0)
            der = metric(reference, hypothesis)
            
            self.RESULTS[f"{audio_file}_der"] = {
                "der": float(der),
                "num_speakers": len(set(s.speaker_id for s in result.segments)),
                "model": "large-v3-turbo"
            }

    def teardown_method(self):
        if hasattr(self, '_benchmark_json') and self.RESULTS:
            os.makedirs(os.path.dirname(self._benchmark_json), exist_ok=True)
            with open(self._benchmark_json, 'w') as f:
                json.dump(self.RESULTS, f, indent=2)


class RawAccuracyBenchmarks:
    """Pure computation benchmarks (no audio fixtures needed)."""

    def test_model_load_time(self):
        """Benchmark model loading time."""
        import time
        start = time.time()
        
        from meeting_processor.pipeline import MeetingProcessor
        processor = MeetingProcessor()
        processor.initialize(model_size="large-v3-turbo", device="cpu")
        
        load_time = time.time() - start
        assert load_time < 60, f"Model load too slow: {load_time:.1f}s"
        print(f"\n  Model load time: {load_time:.1f}s")

    def test_vad_inference_speed(self):
        """Benchmark VAD inference speed on synthetic audio."""
        import time
        import numpy as np
        import torch
        import soundfile as sf
        
        temp_dir = Path(__file__).parent / "fixtures"
        temp_dir.mkdir(exist_ok=True)
        synth_path = temp_dir / "synthetic_60s.wav"
        
        if not synth_path.exists():
            sr = 16000
            duration = 60
            t = np.linspace(0, duration, sr * duration)
            audio = 0.5 * np.sin(2 * np.pi * 440 * t)
            sf.write(str(synth_path), audio, sr)
        
        from meeting_processor.pipeline import MeetingProcessor
        processor = MeetingProcessor()
        processor.initialize(model_size="large-v3-turbo", device="cpu")
        
        start = time.time()
        segments = processor._run_diarization(str(synth_path), {})
        elapsed = time.time() - start
        
        rtf = elapsed / 60.0
        print(f"\n  Diarization: {elapsed:.1f}s for 60s audio (RTF: {rtf:.2f}x)")
        assert rtf < 5.0, f"Too slow: {rtf:.1f}x realtime"

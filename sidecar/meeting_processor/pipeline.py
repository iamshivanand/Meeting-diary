import json
import time
import uuid
import numpy as np
from typing import Optional, List, Dict, Any, Callable
from dataclasses import dataclass, asdict


@dataclass
class Segment:
    id: str
    speaker_id: str
    speaker_label: Optional[str]
    text: str
    start: float
    end: float
    confidence: float
    words: Optional[List[Dict[str, Any]]]
    embedding: Optional[List[float]]


@dataclass
class SpeakerInfo:
    id: str
    label: Optional[str]
    color: str
    segments: List[str]
    total_duration: float
    enrolled_name: Optional[str] = None
    enrolled_at: Optional[int] = None
    embedding: Optional[List[float]] = None


@dataclass
class MeetingResult:
    segments: List[Segment]
    speakers: List[SpeakerInfo]
    metadata: Dict[str, Any]


class MeetingProcessor:
    """Main pipeline for meeting transcription + diarization."""

    def __init__(self, progress_callback: Optional[Callable] = None):
        self.progress_callback = progress_callback or self._default_progress
        self.transcriber = None
        self.diarizer = None
        self.speaker_registry = None
        self.vad_model = None

    def initialize(self, model_size: str = "large-v3-turbo", device: str = "auto"):
        self._report_progress("initialization", 0, "Loading models...")

        device = self._detect_device(device)

        from faster_whisper import WhisperModel
        import torch

        compute_type = "int8_float16" if device == "cuda" else "int8"

        self._report_progress("initialization", 25, f"Loading Whisper {model_size}...")
        self.transcriber = WhisperModel(
            model_size_or_path=model_size,
            device=device,
            compute_type=compute_type,
            cpu_threads=4 if device == "cpu" else None,
            num_workers=2
        )

        self._report_progress("initialization", 50, "Loading VAD model...")
        from pyannote.audio import Inference
        self.vad_model = Inference(
            "pyannote/voice-activity-detection",
            device=torch.device(device)
        )

        self._report_progress("initialization", 75, "Loading diarization model...")
        try:
            from pyannote.audio import Pipeline
            self.diarizer = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-community-1",
                use_auth_token=None
            ).to(torch.device(device))
        except Exception:
            self._report_progress("initialization", 75, "Falling back to pyannote 3.1...")
            from pyannote.audio import Pipeline
            self.diarizer = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=None
            ).to(torch.device(device))

        self._report_progress("initialization", 100, "Models loaded")

    def process(self, audio_path: str, options: Dict[str, Any] = None) -> MeetingResult:
        options = options or {}

        if self.transcriber is None or self.diarizer is None:
            self.initialize(
                model_size=options.get("model_size", "large-v3-turbo"),
                device=options.get("device", "auto")
            )

        enable_diarization = options.get("enable_diarization", True)
        enable_transcription = options.get("enable_transcription", True)
        language = options.get("language") or None

        diarization_segments = []
        if enable_diarization:
            self._report_progress("diarization", 10, "Running VAD...")
            vad_result = self._run_vad(audio_path)

            self._report_progress("diarization", 40, "Running speaker diarization...")
            diarization_segments = self._run_diarization(audio_path, options)
            self._report_progress("diarization", 80, "Extracting speaker embeddings...")

            speaker_ids = list(set(d["speaker"] for d in diarization_segments))
            self._report_progress("diarization", 100, f"Diarization complete: {len(speaker_ids)} speakers found")

        transcription_segments = []
        if enable_transcription:
            self._report_progress("transcription", 10, "Starting transcription...")
            info, raw_segments = self._run_transcription(audio_path, language)
            self._report_progress("transcription", 90, "Aligning timestamps...")

            language = info.language
            transcription_segments = []
            for i, seg in enumerate(raw_segments):
                words_data = None
                if seg.words:
                    words_data = [
                        {"word": w.word, "start": w.start, "end": w.end, "confidence": w.probability}
                        for w in seg.words
                    ]
                transcription_segments.append({
                    "id": str(uuid.uuid4()),
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text.strip(),
                    "confidence": seg.avg_logprob if hasattr(seg, 'avg_logprob') else 0.0,
                    "words": words_data
                })

            self._report_progress("transcription", 100, f"Transcription complete: {len(transcription_segments)} segments")

        self._report_progress("alignment", 50, "Merging diarization and transcription...")
        merged = self._merge_pipelines(transcription_segments, diarization_segments)

        embeddings_map = {}
        if enable_diarization:
            self._report_progress("embeddings", 50, "Computing speaker embeddings...")

        speaker_colors = [
            "#4A90D9", "#E74C3C", "#2ECC71", "#F39C12", "#9B59B6",
            "#1ABC9C", "#E67E22", "#3498DB", "#E91E63", "#00BCD4"
        ]

        speaker_ids_order = list(dict.fromkeys(
            [s["speaker_id"] for s in merged]
        ))

        speakers = []
        for i, sid in enumerate(speaker_ids_order):
            speaker_segments = [s for s in merged if s["speaker_id"] == sid]
            total_dur = sum(s["end"] - s["start"] for s in speaker_segments)
            speakers.append(SpeakerInfo(
                id=sid,
                label=None,
                color=speaker_colors[i % len(speaker_colors)],
                segments=[s["id"] for s in speaker_segments],
                total_duration=total_dur,
                embedding=embeddings_map.get(sid)
            ))

        segments = []
        for s in merged:
            segments.append(Segment(
                id=s["id"],
                speaker_id=s["speaker_id"],
                speaker_label=None,
                text=s["text"],
                start=s["start"],
                end=s["end"],
                confidence=s["confidence"],
                words=s.get("words"),
                embedding=embeddings_map.get(s["speaker_id"])
            ))

        self._report_progress("complete", 100, "Meeting processing complete")

        return MeetingResult(
            segments=segments,
            speakers=speakers,
            metadata={
                "language": language,
                "duration": info.duration if hasattr(info, 'duration') else 0,
                "model": options.get("model_size", "large-v3-turbo"),
                "processed_at": time.time()
            }
        )

    def _run_vad(self, audio_path: str) -> Any:
        from pyannote.core import Segment as PyaSegment
        waveform, sample_rate = self._load_audio(audio_path)
        result = self.vad_model({"waveform": waveform, "sample_rate": sample_rate})
        return result

    def _run_diarization(self, audio_path: str, options: Dict[str, Any]) -> List[Dict]:
        from pyannote.core import Segment as PyaSegment

        diarize_options = {}
        if options.get("min_speakers"):
            diarize_options["min_speakers"] = options["min_speakers"]
        if options.get("max_speakers"):
            diarize_options["max_speakers"] = options["max_speakers"]
        if options.get("num_speakers"):
            diarize_options["num_speakers"] = options["num_speakers"]

        result = self.diarizer(audio_path, **diarize_options)

        segments = []
        for turn, _, speaker in result.itertracks(yield_label=True):
            segments.append({
                "speaker": speaker,
                "start": turn.start,
                "end": turn.end
            })

        segments.sort(key=lambda x: x["start"])
        segments = self._merge_near_segments(segments, gap=0.5)

        return segments

    def _run_transcription(self, audio_path: str, language: Optional[str]):
        segments_gen, info = self.transcriber.transcribe(
            audio_path,
            language=language,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                threshold=0.5,
                min_speech_duration_ms=250,
                min_silence_duration_ms=100
            ),
            word_timestamps=True,
            batch_size=16,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            condition_on_previous_text=True,
        )

        segments = list(segments_gen)
        return info, segments

    def _merge_pipelines(
        self,
        transcription_segments: List[Dict],
        diarization_segments: List[Dict]
    ) -> List[Dict]:
        if not diarization_segments:
            return [dict(s, speaker_id="SPEAKER_00") for s in transcription_segments]

        if not transcription_segments:
            return [{
                "id": str(uuid.uuid4()),
                "speaker_id": d["speaker"],
                "text": "",
                "start": d["start"],
                "end": d["end"],
                "confidence": 0.0,
                "words": None
            } for d in diarization_segments]

        merged = []
        for tseg in transcription_segments:
            t_mid = (tseg["start"] + tseg["end"]) / 2
            assigned_speaker = "SPEAKER_00"
            best_overlap = 0

            for dseg in diarization_segments:
                overlap = self._calc_overlap(tseg, dseg)
                if overlap > best_overlap:
                    best_overlap = overlap
                    assigned_speaker = dseg["speaker"]

            merged.append(dict(tseg, speaker_id=assigned_speaker))

        return merged

    def _calc_overlap(self, seg_a: Dict, seg_b: Dict) -> float:
        start = max(seg_a["start"], seg_b["start"])
        end = min(seg_a["end"], seg_b["end"])
        if end > start:
            return end - start
        return 0.0

    def _merge_near_segments(self, segments: List[Dict], gap: float = 0.5) -> List[Dict]:
        if not segments:
            return []

        merged = [segments[0].copy()]
        for seg in segments[1:]:
            last = merged[-1]
            if seg["speaker"] == last["speaker"] and seg["start"] - last["end"] <= gap:
                last["end"] = max(last["end"], seg["end"])
            else:
                merged.append(seg.copy())
        return merged

    def _load_audio(self, path: str):
        import librosa
        waveform, sample_rate = librosa.load(path, sr=16000, mono=True)
        import torch
        return torch.from_numpy(waveform).unsqueeze(0), sample_rate

    def _detect_device(self, device: str) -> str:
        if device == "auto":
            import torch
            return "cuda" if torch.cuda.is_available() else "cpu"
        return device

    def download_models(self, progress_callback: Optional[Callable] = None):
        """Download all required ML models proactively. After this, initialize() is a no-op."""
        cb = progress_callback or self._default_progress
        device = self._detect_device("auto")

        cb({"stage": "downloading", "model": "faster-whisper", "percent": 0, "message": "Downloading Whisper large-v3-turbo..."})
        from faster_whisper import WhisperModel
        import torch
        compute_type = "int8_float16" if device == "cuda" else "int8"
        self.transcriber = WhisperModel(
            model_size_or_path="large-v3-turbo",
            device=device,
            compute_type=compute_type,
            cpu_threads=4 if device == "cpu" else None,
            num_workers=2
        )
        cb({"stage": "done", "model": "faster-whisper", "percent": 100, "message": "Whisper model ready"})

        cb({"stage": "downloading", "model": "pyannote-embedding", "percent": 0, "message": "Downloading VAD/embedding model..."})
        from pyannote.audio import Inference
        self.vad_model = Inference("pyannote/voice-activity-detection", device=torch.device(device))
        cb({"stage": "done", "model": "pyannote-embedding", "percent": 100, "message": "VAD model ready"})

        cb({"stage": "downloading", "model": "pyannote-segmentation", "percent": 0, "message": "Downloading diarization model..."})
        try:
            from pyannote.audio import Pipeline
            self.diarizer = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-community-1",
                use_auth_token=None
            ).to(torch.device(device))
        except Exception:
            from pyannote.audio import Pipeline
            self.diarizer = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=None
            ).to(torch.device(device))
        cb({"stage": "done", "model": "pyannote-segmentation", "percent": 100, "message": "Diarization model ready"})

        cb({"stage": "done", "model": "all", "percent": 100, "message": "All models ready"})

    def _report_progress(self, stage: str, progress: int, message: str):
        if self.progress_callback:
            self.progress_callback({"stage": stage, "progress": progress, "message": message})

    @staticmethod
    def _default_progress(data: Dict):
        print(json.dumps({"method": "progress", "params": data}))

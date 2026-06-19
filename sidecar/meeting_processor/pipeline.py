import json
import time
import uuid
import os
import numpy as np
import librosa
import noisereduce as nr
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


class SileroVAD:
    """Lightweight VAD using Silero model via onnx (no torch needed)"""

    def __init__(self):
        self.model = None

    def _load_model(self):
        if self.model is not None:
            return
        try:
            import onnxruntime
            model_path = os.path.join(os.path.dirname(__file__), "silero_vad.onnx")
            if not os.path.exists(model_path):
                import urllib.request
                url = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
                urllib.request.urlretrieve(url, model_path)
            self.model = onnxruntime.InferenceSession(model_path)
        except Exception as e:
            print(f"  [VAD] Failed to load Silero ONNX model: {e}", flush=True)
            self.model = None

    def get_speech_timestamps(self, audio: np.ndarray, sr: int = 16000) -> list:
        """Returns list of (start_sec, end_sec) speech segments"""
        self._load_model()
        if self.model is None:
            duration = len(audio) / sr
            return [(0.0, duration)]

        window_size = 512
        threshold = 0.5

        speech_frames = []
        for i in range(0, len(audio) - window_size, window_size):
            chunk = audio[i:i + window_size].astype(np.float32)
            if len(chunk) < window_size:
                break
            inputs = {self.model.get_inputs()[0].name: chunk.reshape(1, -1)}
            outputs = self.model.run(None, inputs)
            prob = float(outputs[0][0][0])
            speech_frames.append(prob > threshold)

        segments = []
        in_speech = False
        start_frame = 0
        for idx, is_speech in enumerate(speech_frames):
            if is_speech and not in_speech:
                start_frame = idx
                in_speech = True
            elif not is_speech and in_speech:
                end_sec = (idx * window_size) / sr
                start_sec = (start_frame * window_size) / sr
                if end_sec - start_sec > 0.3:
                    segments.append((start_sec, end_sec))
                in_speech = False

        if in_speech:
            start_sec = (start_frame * window_size) / sr
            end_sec = len(audio) / sr
            if end_sec - start_sec > 0.3:
                segments.append((start_sec, end_sec))

        return segments


class ParakeetTDT:
    """NVIDIA Parakeet TDT 0.6B ASR model via ONNX runtime"""

    def __init__(self):
        self.model = None
        self.sample_rate = 16000

    def _load_model(self):
        if self.model is not None:
            return
        try:
            import onnx_asr
            self.model = onnx_asr.load_model("nemo-parakeet-tdt-0.6b-v2")
            print("  [Parakeet] Model loaded successfully", flush=True)
        except Exception as e:
            print(f"  [Parakeet] Failed to load model: {e}", flush=True)
            self.model = None

    def transcribe(self, audio_path: str) -> tuple:
        self._load_model()
        if self.model is None:
            raise RuntimeError("Parakeet model not available")

        audio, sr = librosa.load(audio_path, sr=self.sample_rate, mono=True)
        duration = len(audio) / sr

        result = self.model.recognize(audio, return_timestamps=True)

        if isinstance(result, str):
            segments = [{'start': 0.0, 'end': duration, 'text': result.strip()}]
        elif isinstance(result, list):
            segments = []
            for seg in result:
                segments.append({
                    'start': seg.get('start', 0),
                    'end': seg.get('end', duration),
                    'text': seg.get('text', '')
                })
        else:
            segments = []

        return segments, {'language': 'en', 'duration': duration}


class MeetingProcessor:
    """Main pipeline for meeting transcription + diarization."""

    def __init__(self, config: dict = None, progress_callback: Optional[Callable] = None):
        self.progress_callback = progress_callback or self._default_progress
        self.config = config or {}
        self.use_vad = self.config.get('use_vad', True)
        self.use_noise_reduction = self.config.get('use_noise_reduction', True)
        self.asr_model = self.config.get('asr_model', 'faster-whisper')
        self.initial_prompt = self.config.get('initial_prompt', None)
        self.language = self.config.get('language', None)

        self.transcriber = None
        self.diarizer = None
        self.speaker_registry = None
        self.vad_model = None

        self.vad = SileroVAD()
        self.parakeet = None
        if 'parakeet' in self.asr_model:
            self.parakeet = ParakeetTDT()

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

        audio_duration = 0
        transcription_segments = []
        if enable_transcription:
            self._report_progress("transcription", 10, "Starting transcription...")
            transcribe_result = self.transcribe(audio_path, language=language)
            self._report_progress("transcription", 90, "Aligning timestamps...")

            language = transcribe_result.get('language', 'en')
            audio_duration = transcribe_result.get('duration', 0)
            transcription_segments = transcribe_result.get('segments', [])

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
                "duration": audio_duration,
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

    def _transcribe_whisper(self, audio_path: str, language: Optional[str] = None):
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

    def _transcribe_parakeet(self, audio_path: str, language: Optional[str] = None) -> tuple:
        if self.parakeet is None:
            raise RuntimeError("Parakeet model not available")
        return self.parakeet.transcribe(audio_path)

    def preprocess_audio(self, audio_path: str) -> tuple:
        """Load and preprocess audio: noise reduction + normalization.
        Returns (audio_array, sample_rate)"""
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)

        if self.use_noise_reduction:
            try:
                audio = nr.reduce_noise(y=audio, sr=sr, prop_decrease=0.8)
                print(f"  [Preprocess] Applied noise reduction", flush=True)
            except Exception as e:
                print(f"  [Preprocess] Noise reduction failed: {e}", flush=True)

        max_val = np.max(np.abs(audio))
        if max_val > 0:
            audio = audio / max_val * 0.95

        return audio, sr

    def transcribe(self, audio_path: str, language: Optional[str] = None, progress_callback: Optional[Callable] = None) -> dict:
        """Transcribe audio file using configured ASR model"""
        language = language or self.language
        audio, sr = self.preprocess_audio(audio_path)

        preprocessed_path = audio_path + ".preprocessed.wav"
        try:
            import soundfile as sf
            sf.write(preprocessed_path, audio, sr)
        except Exception as e:
            print(f"  [Transcribe] Failed to save preprocessed audio: {e}", flush=True)
            preprocessed_path = audio_path

        vad_segments = []
        if self.use_vad:
            vad_segments = self.vad.get_speech_timestamps(audio, sr)
            print(f"  [VAD] Found {len(vad_segments)} speech segments", flush=True)

        if 'parakeet' in self.asr_model and self.parakeet is not None:
            segments, info = self._transcribe_parakeet(preprocessed_path)
        else:
            whisper_info, whisper_segments = self._transcribe_whisper(preprocessed_path, language)
            segments = []
            for seg in whisper_segments:
                words_data = None
                if seg.words:
                    words_data = [
                        {"word": w.word, "start": w.start, "end": w.end, "confidence": w.probability}
                        for w in seg.words
                    ]
                segments.append({
                    "id": str(uuid.uuid4()),
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text.strip(),
                    "confidence": seg.avg_logprob if hasattr(seg, 'avg_logprob') else 0.0,
                    "words": words_data
                })
            info = {'language': whisper_info.language, 'duration': whisper_info.duration}

        if preprocessed_path != audio_path:
            try:
                os.remove(preprocessed_path)
            except Exception:
                pass

        if self.use_vad and vad_segments:
            filtered_segments = []
            for seg in segments:
                seg_start = seg.get('start', 0)
                seg_end = seg.get('end', 0)
                overlaps = False
                for vs, ve in vad_segments:
                    if seg_start < ve and seg_end > vs:
                        overlaps = True
                        break
                if overlaps or (seg_end - seg_start) < 0.5:
                    filtered_segments.append(seg)
                else:
                    print(f"  [VAD] Filtered segment: '{seg.get('text', '')[:30]}...'", flush=True)
            segments = filtered_segments

        return {
            'segments': segments,
            'language': info.get('language', 'en'),
            'duration': info.get('duration', 0),
        }

    # Backward compatibility alias
    _run_transcription = _transcribe_whisper

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

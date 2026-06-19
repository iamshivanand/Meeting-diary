"""Sidecar server - communicates with Electron via JSON-RPC over stdin/stdout."""

import json
import sys
import traceback
import os
from typing import Any, Dict, Optional

from meeting_processor.pipeline import MeetingProcessor
from meeting_processor.speaker_id import SpeakerRegistry, SpeakerEmbeddingExtractor


class SidecarServer:
    """JSON-RPC server over stdin/stdout."""

    def __init__(self):
        self.processor: Optional[MeetingProcessor] = None
        self.registry = SpeakerRegistry()
        self.embedding_extractor = SpeakerEmbeddingExtractor()
        self.running = True

    def handle_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        method = request.get("method", "")
        params = request.get("params", {})
        req_id = request.get("id", "")

        try:
            handler = getattr(self, f"handle_{method}", None)
            if handler is None:
                raise ValueError(f"Unknown method: {method}")

            result = handler(**params)
            return {"id": req_id, "result": result}

        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return {
                "id": req_id,
                "error": {
                    "code": -1,
                    "message": str(e),
                    "data": traceback.format_exc()
                }
            }

    def handle_ping(self) -> str:
        return "pong"

    def handle_process_meeting(
        self,
        audio_path: str,
        options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        if self.processor is None:
            self.processor = MeetingProcessor(progress_callback=self._progress_callback)

        options = options or {}
        result = self.processor.process(audio_path, options)
        return self._result_to_dict(result)

    def handle_transcribe_file(self, audio_path: str, **kwargs) -> Dict[str, Any]:
        if self.processor is None:
            self.processor = MeetingProcessor(progress_callback=self._progress_callback)
            self.processor.initialize()

        info, segments = self.processor._run_transcription(audio_path, kwargs.get("language"))
        return {
            "language": info.language,
            "duration": info.duration,
            "segments": [
                {
                    "id": s["id"],
                    "start": s["start"],
                    "end": s["end"],
                    "text": s["text"],
                    "confidence": s["confidence"],
                    "words": s.get("words")
                }
                for s in segments
            ]
        }

    def handle_diarize_file(self, audio_path: str, **kwargs) -> Dict[str, Any]:
        if self.processor is None:
            self.processor = MeetingProcessor(progress_callback=self._progress_callback)
            self.processor.initialize()

        segments = self.processor._run_diarization(audio_path, kwargs)
        speakers = list(set(s["speaker"] for s in segments))
        return {
            "speakers": speakers,
            "segments": segments
        }

    def handle_register_speaker(self, name: str, audio_samples: list) -> Dict[str, Any]:
        return self.registry.enroll(name, audio_samples)

    def handle_identify_speaker(self, embedding: list) -> Optional[Dict[str, Any]]:
        return self.registry.identify(embedding)

    def handle_get_speaker_embedding(self, audio_segment: str) -> Optional[Dict[str, Any]]:
        import os
        if not os.path.exists(audio_segment):
            raise FileNotFoundError(f"Audio segment not found: {audio_segment}")

        emb = self.embedding_extractor.extract_whole(audio_segment)
        return {"embedding": emb}

    def handle_get_speaker_profiles(self) -> list:
        return self.registry.get_all_profiles()

    def handle_delete_speaker_profile(self, profile_id: str) -> bool:
        return self.registry.delete_profile(profile_id)

    def handle_suggest_speaker_labels(self, embeddings_map: dict, threshold: float = 0.65) -> dict:
        return self.registry.suggest_labels(embeddings_map, threshold)

    def handle_download_models(self) -> Dict[str, Any]:
        if self.processor is None:
            self.processor = MeetingProcessor(progress_callback=self._progress_callback)
        self.processor.download_models(progress_callback=self._model_download_callback)
        return {"status": "done"}

    def handle_check_models(self) -> Dict[str, Any]:
        return {"downloaded": self.processor is not None and self.processor.transcriber is not None}

    def handle_shutdown(self) -> str:
        self.running = False
        return "shutting_down"

    def _send_notification(self, method: str, params: Dict[str, Any]):
        msg = json.dumps({"method": method, "params": params})
        sys.stdout.write(msg + "\n")
        sys.stdout.flush()

    def _model_download_callback(self, data: Dict[str, Any]):
        self._send_notification("model_download_progress", data)

    def _progress_callback(self, data: Dict[str, Any]):
        msg = json.dumps({"method": "progress", "params": data})
        sys.stdout.write(msg + "\n")
        sys.stdout.flush()

    def _result_to_dict(self, result) -> Dict[str, Any]:
        return {
            "metadata": result.metadata,
            "segments": [
                {
                    "id": s.id,
                    "speaker_id": s.speaker_id,
                    "speaker_label": s.speaker_label,
                    "text": s.text,
                    "start": s.start,
                    "end": s.end,
                    "confidence": s.confidence,
                    "words": s.words,
                    "embedding": s.embedding
                }
                for s in result.segments
            ],
            "speakers": [
                {
                    "id": s.id,
                    "label": s.label,
                    "color": s.color,
                    "segments": s.segments,
                    "total_duration": s.total_duration,
                    "enrolled_name": s.enrolled_name,
                    "enrolled_at": s.enrolled_at,
                    "embedding": s.embedding
                }
                for s in result.speakers
            ]
        }

    def run(self):
        print("READY", flush=True)
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                request = json.loads(line)
            except json.JSONDecodeError as e:
                response = {"id": None, "error": {"code": -32700, "message": f"Parse error: {e}"}}
                print(json.dumps(response), flush=True)
                continue

            response = self.handle_request(request)
            print(json.dumps(response), flush=True)

            if not self.running:
                break


if __name__ == "__main__":
    server = SidecarServer()
    server.run()

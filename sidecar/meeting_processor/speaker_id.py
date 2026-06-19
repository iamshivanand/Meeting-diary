import json
import os
import uuid
import numpy as np
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class SpeakerProfile:
    id: str
    name: str
    embedding: np.ndarray
    created_at: int
    updated_at: int
    sample_count: int


class SpeakerRegistry:
    """Local speaker enrollment and identification using cosine similarity."""

    def __init__(self, registry_path: str = None):
        if registry_path is None:
            registry_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "data", "speaker_registry"
            )
        self.registry_path = Path(registry_path)
        self.registry_path.mkdir(parents=True, exist_ok=True)
        self.profiles: Dict[str, SpeakerProfile] = {}
        self._load()

    def enroll(self, name: str, audio_samples: List[str]) -> Dict:
        if not audio_samples:
            raise ValueError("No valid audio samples provided")

        from pyannote.audio import Inference, Model
        import torch

        embeddings = []
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        model = Model.from_pretrained("pyannote/embedding", use_auth_token=None)
        embedding_model = Inference(
            model,
            device=device,
            window="whole"
        )

        for sample_path in audio_samples:
            if os.path.exists(sample_path):
                emb = embedding_model(sample_path)
                embeddings.append(emb)

        if not embeddings:
            raise ValueError("No valid audio samples provided")

        avg_embedding = np.mean(embeddings, axis=0)
        avg_embedding = avg_embedding / np.linalg.norm(avg_embedding)

        now = int(__import__('time').time() * 1000)
        profile_id = str(uuid.uuid4())

        profile = SpeakerProfile(
            id=profile_id,
            name=name,
            embedding=avg_embedding,
            created_at=now,
            updated_at=now,
            sample_count=len(embeddings)
        )

        self.profiles[profile_id] = profile
        self._save()

        return {"id": profile_id, "name": name, "sample_count": len(embeddings)}

    def identify(self, embedding: List[float], threshold: float = 0.65) -> Optional[Dict]:
        if not self.profiles:
            return None

        query = np.array(embedding, dtype=np.float64)
        query = query / np.linalg.norm(query)

        best_match = None
        best_score = 0

        for profile in self.profiles.values():
            similarity = np.dot(query, profile.embedding)
            similarity = float(np.clip(similarity, -1, 1))

            if similarity > best_score:
                best_score = similarity
                best_match = profile

        if best_match and best_score >= threshold:
            return {
                "id": best_match.id,
                "name": best_match.name,
                "confidence": best_score
            }

        return None

    def suggest_labels(
        self,
        embeddings_map: Dict[str, List[float]],
        threshold: float = 0.65
    ) -> Dict[str, Optional[Dict]]:
        suggestions = {}
        for speaker_id, emb in embeddings_map.items():
            match = self.identify(emb, threshold)
            suggestions[speaker_id] = match
        return suggestions

    def get_all_profiles(self) -> List[Dict]:
        return [
            {
                "id": p.id,
                "name": p.name,
                "sample_count": p.sample_count,
                "created_at": p.created_at
            }
            for p in self.profiles.values()
        ]

    def delete_profile(self, profile_id: str) -> bool:
        if profile_id in self.profiles:
            del self.profiles[profile_id]
            self._save()
            return True
        return False

    def _save(self):
        data = []
        for profile in self.profiles.values():
            data.append({
                "id": profile.id,
                "name": profile.name,
                "embedding": profile.embedding.tolist(),
                "created_at": profile.created_at,
                "updated_at": profile.updated_at,
                "sample_count": profile.sample_count
            })

        with open(self.registry_path / "registry.json", "w") as f:
            json.dump(data, f)

    def _load(self):
        registry_file = self.registry_path / "registry.json"
        if registry_file.exists():
            with open(registry_file) as f:
                data = json.load(f)

            for entry in data:
                self.profiles[entry["id"]] = SpeakerProfile(
                    id=entry["id"],
                    name=entry["name"],
                    embedding=np.array(entry["embedding"], dtype=np.float64),
                    created_at=entry["created_at"],
                    updated_at=entry["updated_at"],
                    sample_count=entry["sample_count"]
                )


class SpeakerEmbeddingExtractor:
    """Extract speaker embeddings from audio segments."""

    def __init__(self, device: str = "auto"):
        self.device = device
        self.model = None

    def _lazy_init(self):
        if self.model is None:
            import torch
            from pyannote.audio import Inference

            if self.device == "auto":
                self.device = "cuda" if torch.cuda.is_available() else "cpu"

            self.model = Inference(
                "pyannote/embedding",
                device=torch.device(self.device),
                window="whole"
            )

    def extract(self, audio_path: str, start: float, end: float) -> List[float]:
        self._lazy_init()
        emb = self.model({
            "uri": audio_path,
            "start": start,
            "end": end
        })
        emb = emb / np.linalg.norm(emb)
        return emb.tolist()

    def extract_whole(self, audio_path: str) -> List[float]:
        self._lazy_init()
        emb = self.model(audio_path)
        emb = emb / np.linalg.norm(emb)
        return emb.tolist()

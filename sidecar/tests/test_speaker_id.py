"""Unit tests for speaker identification module."""

import sys
import os
import json
import importlib
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import numpy as np
from meeting_processor.speaker_id import SpeakerRegistry, SpeakerProfile


class TestSpeakerProfile:
    def test_profile_creation(self):
        profile = SpeakerProfile(
            id="test-id",
            name="John",
            embedding=np.array([0.1, 0.2, 0.3], dtype=np.float64),
            created_at=1234567890,
            updated_at=1234567890,
            sample_count=1
        )
        assert profile.id == "test-id"
        assert profile.name == "John"
        assert profile.embedding.shape == (3,)
        assert profile.sample_count == 1


class TestSpeakerRegistry:
    @pytest.fixture
    def registry(self, tmp_path):
        return SpeakerRegistry(str(tmp_path))

    def test_initialization(self, tmp_path):
        reg = SpeakerRegistry(str(tmp_path))
        assert len(reg.profiles) == 0
        assert reg.registry_path == tmp_path

    def test_enroll_without_samples(self, registry):
        pytest.importorskip("pyannote.audio")
        with pytest.raises(ValueError, match="No valid audio samples"):
            registry.enroll("John", [])

    def test_identify_empty_registry(self, registry):
        result = registry.identify([0.1, 0.2, 0.3])
        assert result is None

    def test_identify_with_profiles(self, registry):
        emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        emb1 = emb1 / np.linalg.norm(emb1)
        profile = SpeakerProfile(
            id="p1", name="John", embedding=emb1,
            created_at=1000, updated_at=1000, sample_count=1
        )
        registry.profiles["p1"] = profile

        result = registry.identify([1.0, 0.0, 0.0], threshold=0.5)
        assert result is not None
        assert result["name"] == "John"
        assert result["confidence"] > 0.9

    def test_identify_with_low_confidence(self, registry):
        emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        emb1 = emb1 / np.linalg.norm(emb1)
        profile = SpeakerProfile(
            id="p1", name="John", embedding=emb1,
            created_at=1000, updated_at=1000, sample_count=1
        )
        registry.profiles["p1"] = profile

        result = registry.identify([0.0, 1.0, 0.0], threshold=0.9)
        assert result is None

    def test_suggest_labels(self, registry):
        emb = [1.0, 0.0, 0.0]
        result = registry.suggest_labels({"A": emb}, threshold=0.9)
        assert "A" in result
        assert result["A"] is None

        emb1 = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        emb1 = emb1 / np.linalg.norm(emb1)
        profile = SpeakerProfile(
            id="p1", name="John", embedding=emb1,
            created_at=1000, updated_at=1000, sample_count=1
        )
        registry.profiles["p1"] = profile

        result = registry.suggest_labels({"A": [1.0, 0.0, 0.0]}, threshold=0.5)
        assert result["A"] is not None
        assert result["A"]["name"] == "John"

    def test_get_all_profiles(self, registry):
        assert registry.get_all_profiles() == []

        emb = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        profile = SpeakerProfile(
            id="p1", name="John", embedding=emb,
            created_at=1000, updated_at=1000, sample_count=1
        )
        registry.profiles["p1"] = profile

        profiles = registry.get_all_profiles()
        assert len(profiles) == 1
        assert profiles[0]["name"] == "John"

    def test_delete_profile(self, registry):
        emb = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        profile = SpeakerProfile(
            id="p1", name="John", embedding=emb,
            created_at=1000, updated_at=1000, sample_count=1
        )
        registry.profiles["p1"] = profile

        assert registry.delete_profile("p1") is True
        assert len(registry.profiles) == 0

    def test_delete_nonexistent_profile(self, registry):
        assert registry.delete_profile("nonexistent") is False

    def test_persist_to_disk(self, tmp_path):
        reg = SpeakerRegistry(str(tmp_path))
        emb = np.array([1.0, 0.0, 0.0], dtype=np.float64)
        emb = emb / np.linalg.norm(emb)
        now = int(importlib.import_module('time').time() * 1000)
        profile = SpeakerProfile(id="test-persist", name="John", embedding=emb,
                                 created_at=now, updated_at=now, sample_count=1)
        reg.profiles[profile.id] = profile
        reg._save()

        reg2 = SpeakerRegistry(str(tmp_path))
        assert len(reg2.profiles) == 1
        assert reg2.profiles["test-persist"].name == "John"

    def test_concurrent_identify(self, registry):
        embeddings = []
        for i in range(5):
            emb = np.random.randn(256).astype(np.float64)
            emb = emb / np.linalg.norm(emb)
            embeddings.append(emb)
            profile = SpeakerProfile(
                id=f"p{i}", name=f"Speaker_{i}", embedding=emb,
                created_at=1000, updated_at=1000, sample_count=1
            )
            registry.profiles[f"p{i}"] = profile

        for i, emb in enumerate(embeddings):
            result = registry.identify(emb.tolist(), threshold=0.8)
            assert result is not None
            assert result["name"] == f"Speaker_{i}"

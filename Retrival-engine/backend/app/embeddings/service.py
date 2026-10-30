from functools import lru_cache

import numpy as np


class EmbeddingService:
    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer

        self.model_name = model_name
        self.model = SentenceTransformer(model_name)
        self.dimension = self.model.get_sentence_embedding_dimension()
        if not self.dimension:
            raise RuntimeError("Embedding model did not report a vector dimension")

    def embed(self, text: str) -> np.ndarray:
        if not text.strip():
            raise ValueError("Cannot embed empty text")
        vector = self.model.encode(text, normalize_embeddings=True, convert_to_numpy=True)
        return np.asarray(vector, dtype=np.float32)

    def embed_many(self, texts: list[str]) -> list[np.ndarray]:
        if any(not text.strip() for text in texts):
            raise ValueError("Cannot embed empty text")
        vectors = self.model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
        return [np.asarray(vector, dtype=np.float32) for vector in vectors]


@lru_cache
def get_embedding_service(model_name: str) -> EmbeddingService:
    return EmbeddingService(model_name)

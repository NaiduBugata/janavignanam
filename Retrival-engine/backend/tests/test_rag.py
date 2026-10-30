import asyncio

from app.rag.service import RagService


class EmptyRetrieval:
    def retrieve(self, question: str, top_k: int | None = None):
        return []


class UnusedGroq:
    async def generate(self, question: str, context: str):
        raise AssertionError("Groq should not be called without context")


def test_rag_reports_missing_context() -> None:
    response = asyncio.run(RagService(EmptyRetrieval(), UnusedGroq()).answer("unknown"))
    assert response.has_context is False
    assert "does not contain enough information" in response.answer

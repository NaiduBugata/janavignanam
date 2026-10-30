from uuid import UUID, uuid4

from app.groq.service import GroqService
from app.retrieval.service import RetrievalService
from app.schemas.models import QueryResponse, SourceReference


class RagService:
    def __init__(self, retrieval: RetrievalService, groq: GroqService) -> None:
        self.retrieval = retrieval
        self.groq = groq

    async def answer(self, question: str, top_k: int | None = None,
                     document_id: UUID | str | None = None) -> QueryResponse:
        if document_id is None:
            results = self.retrieval.retrieve(question, top_k)
        else:
            results = self.retrieval.retrieve(question, top_k, document_id)
        sources = [
            SourceReference(
                document_id=result.document_id,
                document_name=result.document_name,
                chunk_id=result.chunk_id,
                chunk_index=result.chunk_index,
                score=result.score,
                content=result.content,
            )
            for result in results
        ]
        if not results:
            return QueryResponse(
                query_id=uuid4(),
                answer="The uploaded document does not contain enough information to answer that question.",
                sources=[],
                has_context=False,
            )
        context = "\n\n".join(
            f"[{result.document_name}, chunk {result.chunk_index}, score {result.score:.3f}]\n{result.content}"
            for result in results
        )
        answer = await self.groq.generate(question, context)
        return QueryResponse(query_id=uuid4(), answer=answer, sources=sources, has_context=True)

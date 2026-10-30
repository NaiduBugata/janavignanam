import asyncio
import logging

from app.config.settings import Settings

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = (
    "You are a document-grounded AI assistant. Answer questions using only the provided "
    "retrieved document context. Give a direct, accurate, concise answer. Preserve important "
    "facts, names, dates, numerical values, and technical details. Never invent facts or "
    "introduce unsupported information. If context is insufficient, clearly state that the "
    "uploaded document does not contain enough information."
)


class GroqService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = None
        if settings.groq_api_key:
            from groq import Groq

            self.client = Groq(api_key=settings.groq_api_key, timeout=settings.groq_timeout_seconds)

    async def generate(self, question: str, context: str) -> str:
        if not self.client or not self.settings.groq_model:
            raise RuntimeError("GROQ_API_KEY and GROQ_MODEL must be configured")
        prompt = f"Question:\n{question}\n\nRetrieved document context:\n{context}"
        logger.info("[GROQ]\nContext length: %s\nAPI status: requesting", len(context))
        try:
            response = await asyncio.to_thread(
                self.client.chat.completions.create,
                model=self.settings.groq_model,
                messages=[{"role": "system", "content": SYSTEM_PROMPT},
                          {"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=800,
            )
        except Exception:
            logger.exception("[GROQ]\nContext length: %s\nAPI status: failed", len(context))
            raise
        logger.info("[GROQ]\nContext length: %s\nAPI status: success", len(context))
        return response.choices[0].message.content.strip()

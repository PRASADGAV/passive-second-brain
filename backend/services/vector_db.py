"""
vector_db.py — ChromaDB vector embedding service for Passive Second Brain.

Provides upsert, similarity search, and deletion operations against the
``psb_concepts`` ChromaDB collection via the HTTP client.
"""

import logging
import os
from typing import List

import chromadb
from chromadb.errors import ChromaError

logger = logging.getLogger(__name__)


class VectorDBService:
    """ChromaDB client wrapper for the Passive Second Brain vector store."""

    def __init__(self) -> None:
        chroma_host = os.environ.get("CHROMA_HOST", "").strip()
        chroma_port = os.environ.get("CHROMA_PORT", "").strip()
        persist_dir = os.environ.get("CHROMA_PERSIST_DIR", "./data/chroma")

        # Try connecting via HTTP if a specific remote host is provided
        if chroma_host and chroma_host not in ("localhost", "127.0.0.1", "embedded"):
            try:
                port = int(chroma_port) if chroma_port else 8000
                self.client = chromadb.HttpClient(host=chroma_host, port=port)
                self.collection = self.client.get_or_create_collection("psb_concepts")
                logger.info(
                    "ChromaDB HTTP client connected",
                    extra={"component": "vector_db", "host": chroma_host, "port": port},
                )
                return
            except Exception as exc:
                logger.warning(
                    f"Could not connect to Chroma HTTP server at {chroma_host}:{chroma_port}, falling back to PersistentClient: {exc}"
                )

        # Embedded PersistentClient mode (no separate Chroma server required)
        os.makedirs(persist_dir, exist_ok=True)
        self.client = chromadb.PersistentClient(path=persist_dir)
        self.collection = self.client.get_or_create_collection("psb_concepts")
        logger.info(
            "ChromaDB PersistentClient connected (embedded mode)",
            extra={"component": "vector_db", "path": persist_dir},
        )

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def upsert_embedding(
        self,
        concept_id: str,
        name: str,
        summary: str,
        metadata: dict,
    ) -> None:
        """
        Insert or update the embedding for a concept.

        Document text is ``"{name}. {summary}"`` so that the combined
        semantics of both fields are embedded.  Retries once on connection
        error; logs and continues on final failure without raising.
        """
        doc_text = f"{name}. {summary}"

        for attempt in range(1, 3):  # max 2 attempts (initial + 1 retry)
            try:
                self.collection.upsert(
                    ids=[concept_id],
                    documents=[doc_text],
                    metadatas=[metadata],
                )
                logger.debug(
                    "Upserted embedding for concept_id=%s", concept_id,
                    extra={"component": "vector_db"},
                )
                return
            except (ChromaError, Exception) as exc:  # noqa: BLE001
                if attempt == 1:
                    logger.warning(
                        "ChromaDB upsert attempt %d failed for concept_id=%s: %s — retrying",
                        attempt,
                        concept_id,
                        exc,
                        extra={"component": "vector_db"},
                    )
                else:
                    logger.error(
                        "ChromaDB upsert failed after %d attempts for concept_id=%s: %s",
                        attempt,
                        concept_id,
                        exc,
                        extra={"component": "vector_db"},
                    )
                    # Do not raise — pipeline must continue for remaining concepts

    def delete_embedding(self, concept_id: str) -> None:
        """
        Remove the embedding for a single concept_id.

        Logs on error but does not raise so that callers (e.g. node deletion)
        are not interrupted by a ChromaDB failure.
        """
        try:
            self.collection.delete(ids=[concept_id])
            logger.debug(
                "Deleted embedding for concept_id=%s", concept_id,
                extra={"component": "vector_db"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "ChromaDB delete failed for concept_id=%s: %s",
                concept_id,
                exc,
                extra={"component": "vector_db"},
            )

    def delete_embeddings_by_source(self, source_url: str) -> None:
        """
        Delete all embeddings whose metadata ``source_url`` matches the
        given URL.

        Queries the collection for matching IDs first, then deletes them in
        one call.  Logs how many embeddings were removed.
        """
        try:
            results = self.collection.get(
                where={"source_url": source_url},
                include=[],  # IDs are always returned; no need for documents/embeddings
            )
            ids_to_delete: List[str] = results.get("ids", [])

            if not ids_to_delete:
                logger.info(
                    "No embeddings found for source_url=%s — nothing to delete",
                    source_url,
                    extra={"component": "vector_db"},
                )
                return

            self.collection.delete(ids=ids_to_delete)
            logger.info(
                "Deleted %d embedding(s) for source_url=%s",
                len(ids_to_delete),
                source_url,
                extra={"component": "vector_db"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "ChromaDB delete_by_source failed for source_url=%s: %s",
                source_url,
                exc,
                extra={"component": "vector_db"},
            )

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    def similarity_search(self, query: str, top_k: int = 5) -> List[str]:
        """
        Return the top-k most semantically similar concept_ids for *query*.

        Uses ChromaDB's built-in embedding + ANN query.  Returns an empty
        list on error so that RAG callers degrade gracefully.
        """
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=top_k,
            )
            # results["ids"] is a list-of-lists (one per query); we only send one query
            ids: List[str] = results["ids"][0] if results.get("ids") else []
            return ids
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "ChromaDB similarity_search failed for query=%r: %s",
                query,
                exc,
                extra={"component": "vector_db"},
            )
            return []

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """No-op — ChromaDB HttpClient requires no explicit teardown."""

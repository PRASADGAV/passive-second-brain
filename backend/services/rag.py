"""
rag.py — Hybrid RAG retrieval service for Passive Second Brain.

Implements a four-step retrieval pipeline:
  1. Vector similarity search via ChromaDB (top_k=5)  → concept_ids
  2. Graph neighbourhood expansion via Neo4j (2-hop)   → context nodes
  3. Deduplicate & limit to 8 context chunks
  4. LLM grounded answer via Groq with session history

Requirements:
    16.2 Hybrid RAG (vector + graph)
    16.3 LLM answer grounded in context
    16.4 Source citations
    16.5 ≤ 3s response time
    16.6 Session context (last 10 turns)
    16.7 No hallucination on empty results
"""

import logging
import time
from typing import List

logger = logging.getLogger("psb.rag")

# Maximum context chunks to send to the LLM (keeps within token limits)
MAX_CONTEXT_CHUNKS = 8

# System prompt for the RAG chat
RAG_SYSTEM_PROMPT = """You are the Passive Second Brain assistant. You answer questions using ONLY the knowledge context provided below. Each context item is a concept from the user's personal knowledge graph.

RULES:
1. Answer ONLY based on the provided context. Do NOT make up information.
2. If the context does not contain relevant information, respond with: "No relevant knowledge found in your Second Brain for this query."
3. Cite your sources by referencing concept names in square brackets, e.g. [Concept Name].
4. Be concise and direct. Aim for 1-3 paragraphs.
5. If multiple concepts are relevant, synthesise them into a coherent answer.
6. Mention the domains of the concepts when relevant to help the user understand the knowledge area.

CONTEXT:
{context}
"""


def query(
    q: str,
    session_history: List[dict],
    graph_db,
    vector_db,
    groq_client,
) -> dict:
    """
    Execute the hybrid RAG pipeline.

    Args:
        q:               The user's question.
        session_history: Last 10 conversation turns [{role, content}].
        graph_db:        Neo4jService instance.
        vector_db:       VectorDBService instance.
        groq_client:     GroqClient instance.

    Returns:
        RAGResult-shaped dict: {answer, citations, latency_ms}
    """
    t_start = time.time()

    # ---------------------------------------------------------------
    # Step 1: Vector similarity search (~50ms)
    # ---------------------------------------------------------------
    concept_ids = vector_db.similarity_search(q, top_k=5)

    if not concept_ids:
        latency_ms = round((time.time() - t_start) * 1000, 2)
        logger.info(
            "rag.query: no vector results for query=%r (%.0fms)",
            q, latency_ms,
        )
        return {
            "answer": "No relevant knowledge found in your Second Brain for this query.",
            "citations": [],
            "latency_ms": latency_ms,
        }

    # ---------------------------------------------------------------
    # Step 2: Graph neighbourhood expansion (~100ms)
    # ---------------------------------------------------------------
    context_nodes = {}  # concept_id -> node dict
    context_edges = []

    for cid in concept_ids:
        try:
            neighbourhood = graph_db.get_neighbourhood(cid, hops=2)
            for node in neighbourhood["nodes"]:
                if node.concept_id not in context_nodes:
                    context_nodes[node.concept_id] = {
                        "concept_id": node.concept_id,
                        "name": node.name,
                        "domain": node.domain,
                        "summary": node.summary,
                        "source_url": node.source_url,
                        "forget_score": node.forget_score,
                    }
            context_edges.extend(neighbourhood.get("edges", []))
        except Exception as exc:
            logger.warning("rag: neighbourhood fetch failed for %s: %s", cid, exc)

    if not context_nodes:
        latency_ms = round((time.time() - t_start) * 1000, 2)
        return {
            "answer": "No relevant knowledge found in your Second Brain for this query.",
            "citations": [],
            "latency_ms": latency_ms,
        }

    # ---------------------------------------------------------------
    # Step 3: Deduplicate + limit to MAX_CONTEXT_CHUNKS
    # ---------------------------------------------------------------
    # Prioritise directly matched concepts, then sort by forget_score
    # (fresher knowledge first)
    all_nodes = list(context_nodes.values())

    # Sort: direct matches first, then by forget_score ascending
    def _sort_key(n):
        is_direct = 0 if n["concept_id"] in concept_ids else 1
        return (is_direct, n.get("forget_score", 1.0))

    all_nodes.sort(key=_sort_key)
    selected = all_nodes[:MAX_CONTEXT_CHUNKS]

    # Build context string for LLM
    context_parts = []
    for i, node in enumerate(selected, 1):
        context_parts.append(
            f"[{i}] {node['name']} (domain: {node['domain']})\n"
            f"    Summary: {node['summary']}\n"
            f"    Source: {node['source_url']}"
        )
    context_text = "\n\n".join(context_parts)

    # ---------------------------------------------------------------
    # Step 4: LLM grounded answer with session history
    # ---------------------------------------------------------------
    system_prompt = RAG_SYSTEM_PROMPT.replace("{context}", context_text)

    # Build message list: system + last 10 history turns + current query
    messages = [{"role": "system", "content": system_prompt}]

    # Add session history (last 10 turns)
    history_turns = session_history[-10:] if len(session_history) > 10 else session_history
    for turn in history_turns:
        messages.append({
            "role": turn.get("role", "user"),
            "content": turn.get("content", ""),
        })

    # Add current query
    messages.append({"role": "user", "content": q})

    try:
        answer = groq_client.call_with_history(messages, temperature=0.2)
    except Exception as exc:
        logger.error("rag: LLM call failed: %s", exc)
        answer = (
            "I encountered an error while generating an answer. "
            "The knowledge was retrieved successfully, but the LLM service is unavailable."
        )

    # Build citations from the selected context nodes
    citations = [
        {
            "node_id": node["concept_id"],
            "name": node["name"],
            "source_url": node["source_url"],
            "domain": node["domain"],
        }
        for node in selected
    ]

    latency_ms = round((time.time() - t_start) * 1000, 2)

    logger.info(
        "rag.query: answered in %.0fms (%d context nodes, %d citations)",
        latency_ms, len(selected), len(citations),
    )

    return {
        "answer": answer,
        "citations": citations,
        "latency_ms": latency_ms,
    }

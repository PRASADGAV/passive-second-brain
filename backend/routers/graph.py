"""
graph.py — Knowledge graph REST API router for Passive Second Brain.

Provides CRUD and traversal endpoints over the Neo4j knowledge graph:
  GET    /graph/nodes                   — list all concept nodes (paginated)
  GET    /graph/neighbourhood/{id}      — get connected nodes (1-2 hops)
  GET    /graph/stats                   — node/edge counts + domain breakdown
  POST   /graph/concept                 — create a concept node
  PUT    /graph/concept/{concept_id}    — update an existing concept node
  DELETE /graph/concept/{concept_id}    — delete node + all its edges
  DELETE /graph/source/{source_url}     — delete all nodes from a source URL
  GET    /graph/export/json             — export full graph as JSON download

All write/delete endpoints require X-API-Key header.
Read endpoints are also protected to keep the graph private.

Requirements:
  11.1 (write nodes + edges)
  18.3 (node deletion)
  18.4 (source deletion)
  22.4 (sub-2s queries)
  26.2 (JSON graph export)
  27.1 (all graph ops in REST)
  27.3 (422 on invalid params)
  27.4 (404 on missing resource)
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

try:
    from backend.auth import verify_api_key
    from backend.models.schemas import ConceptNode
except ModuleNotFoundError:
    from auth import verify_api_key
    from models.schemas import ConceptNode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph", tags=["graph"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class CreateConceptRequest(BaseModel):
    concept_id: Optional[str] = None
    name: str
    domain: str
    summary: str
    source_url: str


class UpdateConceptRequest(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    summary: Optional[str] = None
    source_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/nodes",
    summary="List all concept nodes",
    dependencies=[Depends(verify_api_key)],
)
async def list_nodes(
    request: Request,
    skip: int = 0,
    limit: int = 500,
) -> list:
    """Return paginated list of all ConceptNodes."""
    nodes = request.app.state.neo4j.get_all_nodes(skip=skip, limit=limit)
    return [n.model_dump() for n in nodes]


@router.get(
    "/neighbourhood/{concept_id}",
    summary="Get connected nodes within 2 hops",
    dependencies=[Depends(verify_api_key)],
)
async def get_neighbourhood(
    concept_id: str,
    request: Request,
    hops: int = 2,
) -> dict:
    """Return nodes and edges within N hops of the given concept."""
    if hops < 1 or hops > 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="hops must be between 1 and 3.",
        )
    node = request.app.state.neo4j.get_node(concept_id)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept '{concept_id}' not found.",
        )
    result = request.app.state.neo4j.get_neighbourhood(concept_id, hops=hops)
    return {
        "nodes": [n.model_dump() for n in result["nodes"]],
        "edges": result["edges"],
    }


@router.get(
    "/stats",
    summary="Get graph statistics",
    dependencies=[Depends(verify_api_key)],
)
async def get_stats(request: Request) -> dict:
    """Return total node count, edge count, and domain breakdown."""
    return request.app.state.neo4j.get_stats()


@router.get(
    "/export/json",
    summary="Export full knowledge graph as JSON",
    dependencies=[Depends(verify_api_key)],
)
async def export_graph_json(request: Request) -> Response:
    """
    Serialise all ConceptNodes and Edges into a downloadable JSON file.
    File name: psb-graph-export-YYYY-MM-DD.json
    """
    today = datetime.now(timezone.utc).date().isoformat()
    filename = f"psb-graph-export-{today}.json"

    nodes = request.app.state.neo4j.get_all_nodes(skip=0, limit=100_000)

    # Fetch all edges from Neo4j
    cypher_edges = """
        MATCH (a:Concept)-[r]->(b:Concept)
        RETURN a.concept_id AS source_id, b.concept_id AS target_id, type(r) AS type, r.confidence AS confidence, r.created_at AS created_at
    """
    edges = []
    try:
        with request.app.state.neo4j.driver.session() as session:
            result = session.run(cypher_edges)
            for record in result:
                edges.append({
                    "source_id": record["source_id"],
                    "target_id": record["target_id"],
                    "type": record["type"],
                    "confidence": record["confidence"],
                    "created_at": record["created_at"]
                })
    except Exception as exc:
        logger.error("export_graph_json: failed to retrieve edges: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve relationships from knowledge graph."
        )

    export_data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": [n.model_dump(mode="json") for n in nodes],
        "edges": edges,
    }

    content = json.dumps(export_data, indent=2, ensure_ascii=False)

    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ---------------------------------------------------------------------------
# Write endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/concept",
    summary="Create a concept node",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_api_key)],
)
async def create_concept(
    body: CreateConceptRequest,
    request: Request,
) -> dict:
    """Manually create a ConceptNode and store it in Neo4j + ChromaDB."""
    import uuid as _uuid

    now = datetime.now(timezone.utc)
    concept_id = body.concept_id or str(_uuid.uuid4())

    node = ConceptNode(
        concept_id=concept_id,
        name=body.name,
        domain=body.domain,
        summary=body.summary,
        source_url=body.source_url,
        created_at=now,
        last_seen=now,
    )

    request.app.state.neo4j.upsert_node(node)
    request.app.state.vector_db.upsert_embedding(
        concept_id,
        node.name,
        node.summary,
        {"domain": node.domain, "source_url": node.source_url, "forget_score": 0.0},
    )

    logger.info("graph.create_concept: created node %s (%s)", concept_id, node.name)
    return {"concept_id": concept_id, "status": "created"}


# ---------------------------------------------------------------------------
# Update endpoint
# ---------------------------------------------------------------------------

@router.put(
    "/concept/{concept_id}",
    summary="Update an existing concept node",
    dependencies=[Depends(verify_api_key)],
)
async def update_concept(
    concept_id: str,
    body: UpdateConceptRequest,
    request: Request,
) -> dict:
    """
    Partially update a ConceptNode's mutable fields (name, domain, summary,
    source_url). Only supplied fields are modified; omitted fields keep their
    current values.

    Also re-upserts the ChromaDB embedding with the updated name/summary so
    RAG retrieval stays in sync.
    """
    node = request.app.state.neo4j.get_node(concept_id)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept '{concept_id}' not found.",
        )

    # Apply partial updates — only fields that were sent in the request body
    updated_fields: dict = body.model_dump(exclude_none=True)
    if not updated_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one field (name, domain, summary, source_url) must be provided.",
        )

    for field, value in updated_fields.items():
        setattr(node, field, value)

    node.last_seen = datetime.now(timezone.utc)

    # Persist to Neo4j (upsert uses concept_id as merge key)
    request.app.state.neo4j.upsert_node(node)

    # Re-sync ChromaDB embedding with new name/summary
    request.app.state.vector_db.upsert_embedding(
        concept_id,
        node.name,
        node.summary,
        {"domain": node.domain, "source_url": node.source_url, "forget_score": node.forget_score},
    )

    logger.info(
        "graph.update_concept: updated node %s fields=%s",
        concept_id, list(updated_fields.keys()),
    )
    return {"concept_id": concept_id, "status": "updated", "updated_fields": list(updated_fields.keys())}


# ---------------------------------------------------------------------------
# Delete endpoints
# ---------------------------------------------------------------------------

@router.delete(
    "/concept/{concept_id}",
    summary="Delete a concept node and all its edges",
    dependencies=[Depends(verify_api_key)],
)
async def delete_concept(concept_id: str, request: Request) -> dict:
    """
    Permanently remove a ConceptNode from Neo4j and ChromaDB.
    Returns count of nodes and edges removed.
    """
    node = request.app.state.neo4j.get_node(concept_id)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept '{concept_id}' not found.",
        )

    result = request.app.state.neo4j.delete_node(concept_id)
    request.app.state.vector_db.delete_embedding(concept_id)

    logger.info(
        "graph.delete_concept: deleted %s (nodes=%d edges=%d)",
        concept_id, result["nodes_deleted"], result["edges_deleted"],
    )
    return {
        "concept_id": concept_id,
        "nodes_deleted": result["nodes_deleted"],
        "edges_deleted": result["edges_deleted"],
        "status": "deleted",
    }


@router.delete(
    "/source",
    summary="Delete all nodes derived from a source URL",
    dependencies=[Depends(verify_api_key)],
)
async def delete_by_source(source_url: str, request: Request) -> dict:
    """
    Delete all ConceptNodes whose source_url matches the given URL,
    along with all their edges and ChromaDB embeddings.
    """
    if not source_url or not source_url.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="source_url must be a non-empty string.",
        )

    result = request.app.state.neo4j.delete_by_source(source_url)
    request.app.state.vector_db.delete_embeddings_by_source(source_url)

    logger.info(
        "graph.delete_by_source: url=%s nodes=%d edges=%d",
        source_url, result["nodes_deleted"], result["edges_deleted"],
    )
    return {
        "source_url": source_url,
        "nodes_deleted": result["nodes_deleted"],
        "edges_deleted": result["edges_deleted"],
        "status": "deleted",
    }


@router.delete(
    "/source/{source_url:path}",
    summary="Delete all nodes derived from a source URL via path parameter",
    dependencies=[Depends(verify_api_key)],
)
async def delete_by_source_path(source_url: str, request: Request) -> dict:
    """Delete all nodes from the specified source_url (path parameter)."""
    result = request.app.state.neo4j.delete_by_source(source_url)
    request.app.state.vector_db.delete_embeddings_by_source(source_url)
    logger.info(
        "graph.delete_by_source_path: url=%s nodes=%d edges=%d",
        source_url, result["nodes_deleted"], result["edges_deleted"],
    )
    return {
        "source_url": source_url,
        "nodes_deleted": result["nodes_deleted"],
        "edges_deleted": result["edges_deleted"],
        "status": "deleted",
    }


# ---------------------------------------------------------------------------
# Seed endpoint — loads 50 sample concepts for onboarding (Requirement 25.1)
# ---------------------------------------------------------------------------

SAMPLE_CONCEPTS = [
    {"name": "Transformer Architecture", "domain": "Machine Learning", "summary": "Neural network architecture based on self-attention mechanisms, foundational to modern LLMs.", "source_url": "https://arxiv.org/abs/1706.03762"},
    {"name": "Attention Mechanism", "domain": "Machine Learning", "summary": "Allows models to focus on relevant parts of input by computing weighted context vectors.", "source_url": "https://arxiv.org/abs/1706.03762"},
    {"name": "RAG (Retrieval-Augmented Generation)", "domain": "Machine Learning", "summary": "Combines retrieval from a knowledge base with LLM generation for grounded answers.", "source_url": "https://arxiv.org/abs/2005.11401"},
    {"name": "Vector Database", "domain": "Machine Learning", "summary": "Database optimised for storing and querying high-dimensional vector embeddings.", "source_url": "https://www.pinecone.io/learn/vector-database/"},
    {"name": "ChromaDB", "domain": "Machine Learning", "summary": "Open-source, local-first vector database for embedding storage and semantic search.", "source_url": "https://docs.trychroma.com"},
    {"name": "Neo4j", "domain": "System Design", "summary": "Graph database using Cypher query language, optimal for relationship-heavy data models.", "source_url": "https://neo4j.com/docs/"},
    {"name": "Knowledge Graph", "domain": "Machine Learning", "summary": "Graph structure representing entities as nodes and relationships as directed, labelled edges.", "source_url": "https://en.wikipedia.org/wiki/Knowledge_graph"},
    {"name": "SM-2 Algorithm", "domain": "Machine Learning", "summary": "Spaced repetition scheduling algorithm underlying Anki, computing optimal review intervals.", "source_url": "https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method"},
    {"name": "Ebbinghaus Forgetting Curve", "domain": "Machine Learning", "summary": "Exponential decay model of memory retention over time without reinforcement.", "source_url": "https://en.wikipedia.org/wiki/Forgetting_curve"},
    {"name": "Spaced Repetition", "domain": "Machine Learning", "summary": "Learning technique that increases review intervals for material as retention improves.", "source_url": "https://en.wikipedia.org/wiki/Spaced_repetition"},
    {"name": "FastAPI", "domain": "Web Development", "summary": "Modern, high-performance Python web framework with automatic OpenAPI documentation.", "source_url": "https://fastapi.tiangolo.com"},
    {"name": "Pydantic", "domain": "Web Development", "summary": "Python data validation library using type annotations for schema enforcement.", "source_url": "https://docs.pydantic.dev"},
    {"name": "React", "domain": "Web Development", "summary": "JavaScript library for building component-based user interfaces with a virtual DOM.", "source_url": "https://react.dev"},
    {"name": "D3.js", "domain": "Web Development", "summary": "JavaScript library for data-driven document manipulation and interactive visualisations.", "source_url": "https://d3js.org"},
    {"name": "WebSocket", "domain": "Web Development", "summary": "Bidirectional communication protocol enabling real-time data push between server and client.", "source_url": "https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API"},
    {"name": "Docker", "domain": "DevOps", "summary": "Container platform for packaging applications with their dependencies for reproducible deployments.", "source_url": "https://docs.docker.com"},
    {"name": "APScheduler", "domain": "Web Development", "summary": "Python scheduling library supporting cron-style and interval-based background task execution.", "source_url": "https://apscheduler.readthedocs.io"},
    {"name": "Groq API", "domain": "Machine Learning", "summary": "Ultra-fast LLM inference API providing sub-second responses on Llama 3.3 70B.", "source_url": "https://console.groq.com/docs"},
    {"name": "Llama 3.3 70B", "domain": "Machine Learning", "summary": "Meta's open-weight large language model with 70 billion parameters, state-of-the-art on benchmarks.", "source_url": "https://llama.meta.com"},
    {"name": "Tiktoken", "domain": "Machine Learning", "summary": "OpenAI's fast BPE tokeniser used for counting and splitting tokens in LLM inputs.", "source_url": "https://github.com/openai/tiktoken"},
    {"name": "Cypher Query Language", "domain": "System Design", "summary": "Declarative graph query language for Neo4j, using ASCII-art pattern matching.", "source_url": "https://neo4j.com/docs/cypher-manual/"},
    {"name": "PageRank", "domain": "Machine Learning", "summary": "Graph algorithm computing node importance based on the quantity and quality of incoming links.", "source_url": "https://en.wikipedia.org/wiki/PageRank"},
    {"name": "Cosine Similarity", "domain": "Machine Learning", "summary": "Metric measuring the cosine of the angle between two vectors, used for semantic similarity.", "source_url": "https://en.wikipedia.org/wiki/Cosine_similarity"},
    {"name": "Binary Search Tree", "domain": "DSA", "summary": "Tree data structure where each node's left subtree has smaller values and right has larger.", "source_url": "https://en.wikipedia.org/wiki/Binary_search_tree"},
    {"name": "Dynamic Programming", "domain": "DSA", "summary": "Optimisation technique breaking problems into overlapping subproblems with memoisation.", "source_url": "https://en.wikipedia.org/wiki/Dynamic_programming"},
    {"name": "Graph Traversal", "domain": "DSA", "summary": "Algorithms for visiting all nodes in a graph, including BFS and DFS strategies.", "source_url": "https://en.wikipedia.org/wiki/Graph_traversal"},
    {"name": "Big-O Notation", "domain": "DSA", "summary": "Mathematical notation describing the limiting behaviour of a function as input size grows.", "source_url": "https://en.wikipedia.org/wiki/Big_O_notation"},
    {"name": "Hash Table", "domain": "DSA", "summary": "Data structure mapping keys to values using a hash function for O(1) average lookup.", "source_url": "https://en.wikipedia.org/wiki/Hash_table"},
    {"name": "Load Balancer", "domain": "System Design", "summary": "Distributes incoming network traffic across multiple backend servers for availability and performance.", "source_url": "https://en.wikipedia.org/wiki/Load_balancing_(computing)"},
    {"name": "Microservices Architecture", "domain": "System Design", "summary": "Software design pattern decomposing applications into small, independently deployable services.", "source_url": "https://martinfowler.com/articles/microservices.html"},
    {"name": "CAP Theorem", "domain": "System Design", "summary": "States distributed systems can guarantee only two of: Consistency, Availability, Partition tolerance.", "source_url": "https://en.wikipedia.org/wiki/CAP_theorem"},
    {"name": "Event Sourcing", "domain": "System Design", "summary": "Pattern storing state changes as an append-only sequence of events rather than current state.", "source_url": "https://martinfowler.com/eaaDev/EventSourcing.html"},
    {"name": "CQRS", "domain": "System Design", "summary": "Command Query Responsibility Segregation — separates read and write operations for scalability.", "source_url": "https://martinfowler.com/bliki/CQRS.html"},
    {"name": "Kubernetes", "domain": "DevOps", "summary": "Container orchestration platform for automating deployment, scaling, and management of containerised apps.", "source_url": "https://kubernetes.io/docs/"},
    {"name": "CI/CD Pipeline", "domain": "DevOps", "summary": "Automated workflow for continuous integration and delivery of software changes.", "source_url": "https://en.wikipedia.org/wiki/CI/CD"},
    {"name": "Backpropagation", "domain": "Machine Learning", "summary": "Algorithm for computing gradients in neural networks by chain rule for weight updates.", "source_url": "https://en.wikipedia.org/wiki/Backpropagation"},
    {"name": "Gradient Descent", "domain": "Machine Learning", "summary": "Iterative optimisation algorithm minimising loss functions by moving in the negative gradient direction.", "source_url": "https://en.wikipedia.org/wiki/Gradient_descent"},
    {"name": "Overfitting", "domain": "Machine Learning", "summary": "Model learns training data too specifically and fails to generalise to unseen data.", "source_url": "https://en.wikipedia.org/wiki/Overfitting"},
    {"name": "Cross-Entropy Loss", "domain": "Machine Learning", "summary": "Loss function measuring difference between predicted probability distribution and true labels.", "source_url": "https://en.wikipedia.org/wiki/Cross-entropy"},
    {"name": "Dropout Regularisation", "domain": "Machine Learning", "summary": "Training technique randomly disabling neurons to prevent co-adaptation and reduce overfitting.", "source_url": "https://en.wikipedia.org/wiki/Dropout_(neural_networks)"},
    {"name": "Python Asyncio", "domain": "Web Development", "summary": "Python's built-in event loop for writing concurrent code using async/await syntax.", "source_url": "https://docs.python.org/3/library/asyncio.html"},
    {"name": "REST API", "domain": "Web Development", "summary": "Architectural style for distributed systems using HTTP methods and stateless communication.", "source_url": "https://restfulapi.net"},
    {"name": "JWT Authentication", "domain": "Web Development", "summary": "Compact, self-contained token format for securely transmitting user identity information.", "source_url": "https://jwt.io/introduction"},
    {"name": "SQL vs NoSQL", "domain": "System Design", "summary": "Trade-off between structured relational databases and flexible schema-less document or graph stores.", "source_url": "https://en.wikipedia.org/wiki/NoSQL"},
    {"name": "Indexing (Database)", "domain": "System Design", "summary": "Data structure technique improving query speed at the cost of increased storage and write overhead.", "source_url": "https://en.wikipedia.org/wiki/Database_index"},
    {"name": "trafilatura", "domain": "Web Development", "summary": "Python library for extracting clean article text from web pages, removing boilerplate and ads.", "source_url": "https://trafilatura.readthedocs.io"},
    {"name": "Whisper", "domain": "Machine Learning", "summary": "OpenAI's open-source speech recognition model that runs fully offline for local transcription.", "source_url": "https://openai.com/research/whisper"},
    {"name": "Tailwind CSS", "domain": "Web Development", "summary": "Utility-first CSS framework enabling rapid UI development with composable class names.", "source_url": "https://tailwindcss.com"},
    {"name": "Framer Motion", "domain": "Web Development", "summary": "Production-ready animation library for React with declarative gesture and transition APIs.", "source_url": "https://www.framer.com/motion/"},
    {"name": "Chrome Extension MV3", "domain": "Web Development", "summary": "Manifest V3 is the current Chrome Extension platform with service workers replacing background pages.", "source_url": "https://developer.chrome.com/docs/extensions/mv3/intro/"},
]

SAMPLE_EDGES = [
    ("Transformer Architecture", "Attention Mechanism", "IS_PREREQUISITE_FOR"),
    ("RAG (Retrieval-Augmented Generation)", "Vector Database", "IS_USED_IN"),
    ("RAG (Retrieval-Augmented Generation)", "Knowledge Graph", "IS_USED_IN"),
    ("ChromaDB", "Vector Database", "IS_SUBSET_OF"),
    ("SM-2 Algorithm", "Spaced Repetition", "IS_SUBSET_OF"),
    ("Ebbinghaus Forgetting Curve", "SM-2 Algorithm", "IS_PREREQUISITE_FOR"),
    ("Knowledge Graph", "Neo4j", "IS_USED_IN"),
    ("Backpropagation", "Gradient Descent", "IS_USED_IN"),
    ("Gradient Descent", "Overfitting", "CO_OCCURS_WITH"),
    ("Dropout Regularisation", "Overfitting", "IS_USED_IN"),
    ("Dynamic Programming", "Big-O Notation", "CO_OCCURS_WITH"),
    ("Microservices Architecture", "Docker", "IS_USED_IN"),
    ("Kubernetes", "Docker", "EXTENDS"),
    ("Load Balancer", "Microservices Architecture", "IS_USED_IN"),
    ("CAP Theorem", "SQL vs NoSQL", "IS_PREREQUISITE_FOR"),
    ("Indexing (Database)", "SQL vs NoSQL", "CO_OCCURS_WITH"),
    ("Llama 3.3 70B", "Groq API", "IS_USED_IN"),
    ("Transformer Architecture", "Llama 3.3 70B", "IS_PREREQUISITE_FOR"),
    ("Cosine Similarity", "Vector Database", "IS_USED_IN"),
    ("PageRank", "Knowledge Graph", "IS_USED_IN"),
]


@router.post(
    "/seed",
    summary="Seed knowledge graph with 50 sample concepts (onboarding)",
    status_code=200,
    dependencies=[Depends(verify_api_key)],
)
async def seed_graph(request: Request) -> dict:
    """
    Load 50 pre-defined sample concept nodes and 20 edges into Neo4j and ChromaDB.
    Used by the onboarding wizard (Requirement 25.1 — pre-loaded sample graph).
    The source_url 'sample' is used so the user can clear all sample data via
    DELETE /graph/source?source_url=sample.
    """
    import uuid as _uuid

    now = datetime.now(timezone.utc)
    name_to_id: dict[str, str] = {}
    nodes_inserted = 0
    edges_inserted = 0

    for concept in SAMPLE_CONCEPTS:
        cid = str(_uuid.uuid4())
        node = ConceptNode(
            concept_id=cid,
            name=concept["name"],
            domain=concept["domain"],
            summary=concept["summary"],
            source_url=concept.get("source_url", "sample"),
            created_at=now,
            last_seen=now,
        )
        try:
            request.app.state.neo4j.upsert_node(node)
            request.app.state.vector_db.upsert_embedding(
                cid, node.name, node.summary,
                {"domain": node.domain, "source_url": node.source_url, "forget_score": 0.0},
            )
            name_to_id[concept["name"]] = cid
            nodes_inserted += 1
        except Exception as exc:
            logger.warning("seed: failed to insert %s: %s", concept["name"], exc)

    for from_name, to_name, edge_type in SAMPLE_EDGES:
        src = name_to_id.get(from_name)
        tgt = name_to_id.get(to_name)
        if src and tgt:
            try:
                request.app.state.neo4j.upsert_edge(src, tgt, edge_type, 0.9, now)
                edges_inserted += 1
            except Exception as exc:
                logger.warning("seed: failed edge %s->%s: %s", from_name, to_name, exc)

    logger.info("seed: inserted %d nodes, %d edges", nodes_inserted, edges_inserted)
    return {
        "status": "seeded",
        "nodes_inserted": nodes_inserted,
        "edges_inserted": edges_inserted,
    }

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


# ---------------------------------------------------------------------------
# Timeline endpoint — daily concept/edge growth over time
# ---------------------------------------------------------------------------

@router.get(
    "/timeline",
    summary="Get daily knowledge graph growth timeline",
    dependencies=[Depends(verify_api_key)],
)
async def get_timeline(request: Request, days: int = 30) -> list:
    """
    Return per-day counts of concepts added over the last N days.
    Used by the Timeline page to show knowledge growth visually.

    Each entry: { date, nodes_added, edges_added, domains, cumulative_nodes }
    """
    if days < 1 or days > 365:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="days must be between 1 and 365.",
        )

    cypher = """
        MATCH (c:Concept)
        WHERE c.created_at IS NOT NULL
        WITH date(datetime(c.created_at)) AS day, c.domain AS domain
        RETURN day, count(*) AS nodes_added, collect(DISTINCT domain) AS domains
        ORDER BY day DESC
        LIMIT $days
    """

    cypher_edges = """
        MATCH ()-[r]->()
        WHERE r.created_at IS NOT NULL
        WITH date(datetime(r.created_at)) AS day, count(*) AS edges_added
        RETURN day, edges_added
        ORDER BY day DESC
        LIMIT $days
    """

    timeline = {}
    try:
        with request.app.state.neo4j.driver.session() as session:
            # Node counts per day
            result = session.run(cypher, days=days)
            for record in result:
                day_str = str(record["day"])
                timeline[day_str] = {
                    "date": day_str,
                    "nodes_added": record["nodes_added"],
                    "edges_added": 0,
                    "domains": [d for d in record["domains"] if d],
                }

            # Edge counts per day
            result2 = session.run(cypher_edges, days=days)
            for record in result2:
                day_str = str(record["day"])
                if day_str in timeline:
                    timeline[day_str]["edges_added"] = record["edges_added"]
                else:
                    timeline[day_str] = {
                        "date": day_str,
                        "nodes_added": 0,
                        "edges_added": record["edges_added"],
                        "domains": [],
                    }
    except Exception as exc:
        logger.error("get_timeline: query failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve timeline data.",
        )

    # Sort ascending by date and compute cumulative node count
    sorted_days = sorted(timeline.values(), key=lambda x: x["date"])
    cumulative = 0
    for entry in sorted_days:
        cumulative += entry["nodes_added"]
        entry["cumulative_nodes"] = cumulative

    return sorted_days


# ---------------------------------------------------------------------------
# Insights endpoint — PageRank leaders, communities, forgotten, reviewed
# ---------------------------------------------------------------------------

@router.get(
    "/insights",
    summary="Get graph intelligence insights (PageRank, communities, memory stats)",
    dependencies=[Depends(verify_api_key)],
)
async def get_insights(request: Request) -> dict:
    """
    Surface PageRank top concepts, detected communities, most-forgotten
    and most-reviewed nodes.  All data is already computed nightly by the
    scheduler — this endpoint just reads it back.
    """
    top_concepts = []
    communities: dict = {}
    most_forgotten = []
    most_reviewed = []

    try:
        with request.app.state.neo4j.driver.session() as session:

            # ── Top concepts by edge count (PageRank fallback) ────────────
            pr_cypher = """
                MATCH (c:Concept)
                OPTIONAL MATCH (c)-[r]-()
                WITH c, count(r) AS edge_count
                ORDER BY edge_count DESC
                LIMIT 10
                RETURN c.concept_id AS id, c.name AS name, c.domain AS domain,
                       c.summary AS summary,
                       coalesce(c.pagerank, 0.0) AS pagerank,
                       edge_count
            """
            result = session.run(pr_cypher)
            for rec in result:
                top_concepts.append({
                    "concept_id": rec["id"],
                    "name":       rec["name"],
                    "domain":     rec["domain"],
                    "summary":    rec["summary"],
                    "pagerank":   round(float(rec["pagerank"]), 4),
                    "edge_count": rec["edge_count"],
                })

            # ── Community clusters ────────────────────────────────────────
            comm_cypher = """
                MATCH (c:Concept)
                WHERE c.community_id IS NOT NULL
                WITH c.community_id AS cid,
                     collect(c.name)[..5] AS names,
                     count(*) AS size
                ORDER BY size DESC
                LIMIT 8
                RETURN cid, names, size
            """
            result2 = session.run(comm_cypher)
            comm_list = []
            for rec in result2:
                comm_list.append({
                    "id":           rec["cid"],
                    "size":         rec["size"],
                    "top_concepts": list(rec["names"]),
                })
            communities = comm_list

            # ── Most forgotten ────────────────────────────────────────────
            forgot_cypher = """
                MATCH (c:Concept)
                WHERE c.forget_score IS NOT NULL AND c.forget_score > 0
                WITH c.concept_id AS id, c.name AS name,
                     c.domain AS domain, c.forget_score AS forget_score
                ORDER BY forget_score DESC
                LIMIT 5
                RETURN id, name, domain, forget_score
            """
            result3 = session.run(forgot_cypher)
            for rec in result3:
                most_forgotten.append({
                    "concept_id":   rec["id"],
                    "name":         rec["name"],
                    "domain":       rec["domain"],
                    "forget_score": round(float(rec["forget_score"]), 4),
                })

            # ── Most reviewed ─────────────────────────────────────────────
            reviewed_cypher = """
                MATCH (c:Concept)
                WHERE c.rep_count IS NOT NULL AND c.rep_count > 0
                WITH c.concept_id AS id, c.name AS name,
                     c.domain AS domain, c.rep_count AS rep_count,
                     c.ease_factor AS ease_factor
                ORDER BY rep_count DESC
                LIMIT 5
                RETURN id, name, domain, rep_count, ease_factor
            """
            result4 = session.run(reviewed_cypher)
            for rec in result4:
                most_reviewed.append({
                    "concept_id":  rec["id"],
                    "name":        rec["name"],
                    "domain":      rec["domain"],
                    "rep_count":   rec["rep_count"],
                    "ease_factor": round(float(rec["ease_factor"] or 2.5), 2),
                })

    except Exception as exc:
        logger.error("get_insights: query failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve insights data.",
        )

    # Domain breakdown from stats
    graph_stats = {}
    try:
        graph_stats = request.app.state.neo4j.get_stats()
        domain_counts = graph_stats.get("domains", {})
    except Exception:
        domain_counts = {}

    return {
        "top_concepts":   top_concepts,
        "communities":    communities,
        "most_forgotten": most_forgotten,
        "most_reviewed":  most_reviewed,
        "domain_counts":  domain_counts,
        "total_nodes":    graph_stats.get("node_count", 0),
    }


# ---------------------------------------------------------------------------
# Obsidian / Markdown export endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/export/markdown",
    summary="Export knowledge graph as Obsidian-compatible Markdown ZIP",
    dependencies=[Depends(verify_api_key)],
)
async def export_graph_markdown(request: Request) -> Response:
    """
    Generate one Markdown file per ConceptNode with backlinks between
    related concepts. Returns a ZIP file ready to drop into Obsidian.

    File format per concept:
        # Concept Name
        **Domain:** ...   **Retention:** ...%   **Source:** ...

        Summary text...

        ## Related Concepts
        - [[Other Concept]] — RELATIONSHIP_TYPE
    """
    import io
    import zipfile

    today = datetime.now(timezone.utc).date().isoformat()
    filename = f"engram-export-{today}.zip"

    # Fetch all nodes
    nodes = request.app.state.neo4j.get_all_nodes(skip=0, limit=100_000)
    node_map = {n.concept_id: n for n in nodes}

    # Fetch all edges
    edges_cypher = """
        MATCH (a:Concept)-[r]->(b:Concept)
        RETURN a.concept_id AS src, b.concept_id AS tgt,
               type(r) AS rel_type, r.confidence AS confidence
    """
    edges_by_src: dict[str, list] = {}
    try:
        with request.app.state.neo4j.driver.session() as session:
            result = session.run(edges_cypher)
            for rec in result:
                src = rec["src"]
                if src not in edges_by_src:
                    edges_by_src[src] = []
                edges_by_src[src].append({
                    "target_id": rec["tgt"],
                    "type": rec["rel_type"],
                    "confidence": rec["confidence"],
                })
    except Exception as exc:
        logger.error("export_markdown: edge query failed: %s", exc)

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for node in nodes:
            retention_pct = round((1 - (node.forget_score or 0)) * 100)
            source_display = node.source_url or "—"

            lines = [
                f"# {node.name}",
                "",
                f"**Domain:** {node.domain}  "
                f"**Retention:** {retention_pct}%  "
                f"**Reviews:** {node.rep_count}",
                f"**Source:** {source_display}",
                "",
                node.summary or "",
                "",
            ]

            # Related concepts section
            related = edges_by_src.get(node.concept_id, [])
            if related:
                lines.append("## Related Concepts")
                lines.append("")
                for edge in related:
                    target = node_map.get(edge["target_id"])
                    if target:
                        rel_label = edge["type"].replace("_", " ").title()
                        conf = f"({edge['confidence']:.2f})" if edge["confidence"] else ""
                        lines.append(f"- [[{target.name}]] — {rel_label} {conf}".rstrip())
                lines.append("")

            # Tags line for Obsidian
            tag = node.domain.lower().replace(" ", "-")
            lines.append(f"#engram #{tag}")

            # Safe filename: replace slashes and colons
            safe_name = (
                node.name
                .replace("/", "-")
                .replace("\\", "-")
                .replace(":", "-")
                .replace("*", "-")
                .replace("?", "")
                .replace('"', "")
                .replace("<", "")
                .replace(">", "")
                .replace("|", "-")
            )[:80]

            md_content = "\n".join(lines)
            zf.writestr(f"{node.domain}/{safe_name}.md", md_content)

        # Write an index file
        index_lines = [
            f"# ENGRAM Knowledge Export",
            f"",
            f"**Exported:** {today}  ",
            f"**Total Concepts:** {len(nodes)}  ",
            f"**Domains:** {len(set(n.domain for n in nodes))}",
            f"",
            "## All Concepts",
            "",
        ]
        for node in sorted(nodes, key=lambda n: n.domain):
            index_lines.append(f"- [[{node.name}]] ({node.domain})")
        zf.writestr("_INDEX.md", "\n".join(index_lines))

    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ---------------------------------------------------------------------------
# Duplicate detection endpoint
# ---------------------------------------------------------------------------

class MergeRequest(BaseModel):
    keep_id:  str   # concept to keep (absorbs edges + gets merged summary)
    merge_id: str   # concept to delete after merging


@router.get(
    "/duplicates",
    summary="Find near-duplicate concept pairs via name similarity",
    dependencies=[Depends(verify_api_key)],
)
async def get_duplicates(
    request: Request,
    threshold: float = 0.82,
    limit: int = 30,
) -> list:
    """
    Return pairs of concepts whose names are semantically similar enough to
    be potential duplicates.  Uses normalised Levenshtein distance on lowered
    names as a fast, dependency-free proxy for embedding similarity.

    Each pair: { concept_a, concept_b, similarity, reason }
    The calling UI lets the user decide whether to merge or dismiss.
    """
    if threshold < 0.5 or threshold > 1.0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="threshold must be between 0.5 and 1.0.",
        )

    nodes = request.app.state.neo4j.get_all_nodes(skip=0, limit=5000)

    def _norm_lev(a: str, b: str) -> float:
        """Normalised Levenshtein similarity in [0, 1]."""
        a, b = a.lower().strip(), b.lower().strip()
        if a == b:
            return 1.0
        la, lb = len(a), len(b)
        if la == 0 or lb == 0:
            return 0.0
        # Build DP matrix
        prev = list(range(lb + 1))
        for i, ca in enumerate(a, 1):
            curr = [i]
            for j, cb in enumerate(b, 1):
                curr.append(min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + (0 if ca == cb else 1),
                ))
            prev = curr
        dist = prev[lb]
        return 1.0 - dist / max(la, lb)

    pairs = []
    node_list = list(nodes)
    for i in range(len(node_list)):
        for j in range(i + 1, len(node_list)):
            a, b = node_list[i], node_list[j]
            sim = _norm_lev(a.name, b.name)
            if sim >= threshold:
                # Also flag same-domain pairs with lower threshold
                domain_bonus = 0.04 if a.domain == b.domain else 0.0
                if sim + domain_bonus >= threshold:
                    reason = "Identical names" if sim >= 0.99 else \
                             "Very similar names" if sim >= 0.92 else \
                             "Similar names"
                    if a.domain == b.domain:
                        reason += f" · same domain ({a.domain})"
                    pairs.append({
                        "concept_a": {
                            "concept_id": a.concept_id,
                            "name":       a.name,
                            "domain":     a.domain,
                            "rep_count":  a.rep_count,
                            "forget_score": a.forget_score,
                        },
                        "concept_b": {
                            "concept_id": b.concept_id,
                            "name":       b.name,
                            "domain":     b.domain,
                            "rep_count":  b.rep_count,
                            "forget_score": b.forget_score,
                        },
                        "similarity": round(sim, 4),
                        "reason":     reason,
                    })

    pairs.sort(key=lambda p: p["similarity"], reverse=True)
    return pairs[:limit]


# ---------------------------------------------------------------------------
# Merge endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/merge",
    summary="Merge two concept nodes — keep one, delete the other",
    dependencies=[Depends(verify_api_key)],
)
async def merge_concepts(body: MergeRequest, request: Request) -> dict:
    """
    Merge concept *merge_id* into *keep_id*:

    1. Re-point all edges from merge_id → keep_id (skip self-loops)
    2. Re-point all edges to merge_id → keep_id (skip self-loops)
    3. Update keep_id's summary to combine both summaries (if different)
    4. Take the higher rep_count and lower forget_score
    5. Delete merge_id from Neo4j and ChromaDB
    """
    if body.keep_id == body.merge_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="keep_id and merge_id must be different.",
        )

    keep_node  = request.app.state.neo4j.get_node(body.keep_id)
    merge_node = request.app.state.neo4j.get_node(body.merge_id)

    if keep_node is None:
        raise HTTPException(status_code=404, detail=f"Concept '{body.keep_id}' not found.")
    if merge_node is None:
        raise HTTPException(status_code=404, detail=f"Concept '{body.merge_id}' not found.")

    neo4j = request.app.state.neo4j

    try:
        with neo4j.driver.session() as session:

            # 1 & 2 — Re-route all edges touching merge_id to keep_id
            session.run("""
                MATCH (m:Concept {concept_id: $mid})-[r]->(t:Concept)
                WHERE t.concept_id <> $kid
                WITH type(r) AS rel_type, t, r.confidence AS conf,
                     r.created_at AS cat
                MATCH (k:Concept {concept_id: $kid})
                MERGE (k)-[nr:RELATED]->(t)
                ON CREATE SET nr.confidence = conf, nr.created_at = cat
                ON MATCH  SET nr.confidence = CASE
                    WHEN nr.confidence < conf THEN conf ELSE nr.confidence END
            """, mid=body.merge_id, kid=body.keep_id)

            session.run("""
                MATCH (s:Concept)-[r]->(m:Concept {concept_id: $mid})
                WHERE s.concept_id <> $kid
                WITH type(r) AS rel_type, s, r.confidence AS conf,
                     r.created_at AS cat
                MATCH (k:Concept {concept_id: $kid})
                MERGE (s)-[nr:RELATED]->(k)
                ON CREATE SET nr.confidence = conf, nr.created_at = cat
                ON MATCH  SET nr.confidence = CASE
                    WHEN nr.confidence < conf THEN conf ELSE nr.confidence END
            """, mid=body.merge_id, kid=body.keep_id)

            # 3 & 4 — Update keep_node fields
            merged_summary = keep_node.summary or ""
            if merge_node.summary and merge_node.summary not in merged_summary:
                merged_summary = merged_summary + " " + merge_node.summary

            new_rep_count   = max(keep_node.rep_count   or 0, merge_node.rep_count   or 0)
            new_forget_score = min(keep_node.forget_score or 0, merge_node.forget_score or 0)

            session.run("""
                MATCH (k:Concept {concept_id: $kid})
                SET k.summary     = $summary,
                    k.rep_count   = $rc,
                    k.forget_score = $fs
            """,
                kid=body.keep_id,
                summary=merged_summary[:600],
                rc=new_rep_count,
                fs=new_forget_score,
            )

            # 5 — Delete merge_id node
            session.run("""
                MATCH (m:Concept {concept_id: $mid})
                DETACH DELETE m
            """, mid=body.merge_id)

    except Exception as exc:
        logger.error("merge_concepts: failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Merge failed: {exc}")

    # Remove ChromaDB embedding for the deleted concept
    try:
        request.app.state.vector_db.delete_embedding(body.merge_id)
        # Re-upsert keep_node with updated summary
        request.app.state.vector_db.upsert_embedding(
            body.keep_id,
            keep_node.name,
            merged_summary[:600],
            {"domain": keep_node.domain, "source_url": keep_node.source_url or "",
             "forget_score": new_forget_score},
        )
    except Exception as exc:
        logger.warning("merge_concepts: ChromaDB update failed: %s", exc)

    logger.info("merge_concepts: merged %s into %s", body.merge_id, body.keep_id)
    return {
        "status":  "merged",
        "kept_id": body.keep_id,
        "deleted_id": body.merge_id,
        "kept_name":  keep_node.name,
    }

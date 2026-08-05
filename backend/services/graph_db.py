"""
graph_db.py — Neo4j knowledge graph service for Passive Second Brain.

Provides CRUD operations for ConceptNode and Edge objects, with
exponential backoff retry on transient failures.
"""

import logging
import os
import time
from typing import List, Optional

from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable, TransientError

from backend.models.schemas import ConceptNode, Edge, EdgeType

logger = logging.getLogger(__name__)

# All valid edge type label strings
_VALID_EDGE_TYPES = {e.value for e in EdgeType}


class Neo4jService:
    """Sync Neo4j driver wrapper for the Passive Second Brain knowledge graph."""

    def __init__(self) -> None:
        uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687").strip()
        user = os.environ.get("NEO4J_USER", "neo4j").strip()
        if not user or user == "f0eb0005":
            user = "neo4j"
        password = os.environ.get("NEO4J_PASSWORD", "").strip()
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        logger.info("Neo4j driver created", extra={"component": "graph_db", "uri": uri})

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    def init_schema(self) -> None:
        """Create indexes on the Concept node (idempotent)."""
        indexes = [
            "CREATE INDEX concept_id_index IF NOT EXISTS FOR (c:Concept) ON (c.concept_id)",
            "CREATE INDEX concept_name_index IF NOT EXISTS FOR (c:Concept) ON (c.name)",
            "CREATE INDEX concept_domain_index IF NOT EXISTS FOR (c:Concept) ON (c.domain)",
            "CREATE INDEX concept_forget_score_index IF NOT EXISTS FOR (c:Concept) ON (c.forget_score)",
        ]
        with self.driver.session() as session:
            for cypher in indexes:
                session.run(cypher)
        logger.info("Neo4j schema indexes ensured", extra={"component": "graph_db"})

    # ------------------------------------------------------------------
    # Retry helper
    # ------------------------------------------------------------------

    def _with_retry(self, func, *args, max_attempts: int = 3):
        """
        Retry *func* on ServiceUnavailable or TransientError with
        delays of 1 s, 2 s, 4 s between successive attempts.
        Raises the last exception if all attempts fail.
        """
        delays = [1, 2, 4]
        last_exc: Exception = RuntimeError("No attempts made")

        for attempt in range(1, max_attempts + 1):
            try:
                return func(*args)
            except (ServiceUnavailable, TransientError) as exc:
                last_exc = exc
                if attempt < max_attempts:
                    delay = delays[attempt - 1]
                    logger.warning(
                        "Neo4j transient error on attempt %d/%d — retrying in %ds: %s",
                        attempt,
                        max_attempts,
                        delay,
                        exc,
                        extra={"component": "graph_db"},
                    )
                    time.sleep(delay)
                else:
                    logger.error(
                        "Neo4j operation failed after %d attempts: %s",
                        max_attempts,
                        exc,
                        extra={"component": "graph_db"},
                    )

        raise last_exc

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def upsert_node(self, node: ConceptNode) -> None:
        """
        Insert or update a ConceptNode using MERGE so that running the same
        node twice never creates a duplicate.

        On CREATE: all properties are set.
        On MATCH: only mutable fields are updated.
        """
        props = {
            "name": node.name,
            "domain": node.domain,
            "summary": node.summary,
            "source_url": node.source_url,
            "created_at": node.created_at.isoformat(),
            "last_seen": node.last_seen.isoformat(),
            "ease_factor": node.ease_factor,
            "rep_interval": node.rep_interval,
            "rep_count": node.rep_count,
            "forget_score": node.forget_score,
        }

        cypher = """
            MERGE (c:Concept {concept_id: $concept_id})
            ON CREATE SET c += $props
            ON MATCH SET
                c.last_seen    = $last_seen,
                c.forget_score = $forget_score,
                c.summary      = $summary,
                c.ease_factor  = $ease_factor,
                c.rep_interval = $rep_interval,
                c.rep_count    = $rep_count
        """

        def _run():
            with self.driver.session() as session:
                session.run(
                    cypher,
                    concept_id=node.concept_id,
                    props=props,
                    last_seen=node.last_seen.isoformat(),
                    forget_score=node.forget_score,
                    summary=node.summary,
                    ease_factor=node.ease_factor,
                    rep_interval=node.rep_interval,
                    rep_count=node.rep_count,
                )

        self._with_retry(_run)

    def upsert_edge(
        self,
        source_id: str,
        target_id: str,
        edge_type: str,
        confidence: float,
        created_at,
    ) -> None:
        """
        Insert or update a typed relationship between two Concept nodes.

        *edge_type* must be one of the six valid EdgeType values; raises
        ValueError otherwise.  MERGE is used to avoid duplicate edges.
        """
        if edge_type not in _VALID_EDGE_TYPES:
            raise ValueError(
                f"Invalid edge_type '{edge_type}'. "
                f"Must be one of: {sorted(_VALID_EDGE_TYPES)}"
            )

        # Relationship type labels cannot be parameterised in Cypher, so we
        # build the query string dynamically after validating the type above.
        cypher = f"""
            MATCH (a:Concept {{concept_id: $source_id}})
            MATCH (b:Concept {{concept_id: $target_id}})
            MERGE (a)-[r:{edge_type}]->(b)
            ON CREATE SET r.confidence = $confidence, r.created_at = $created_at
            ON MATCH SET  r.confidence = $confidence
        """

        created_at_str = (
            created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
        )

        def _run():
            with self.driver.session() as session:
                session.run(
                    cypher,
                    source_id=source_id,
                    target_id=target_id,
                    confidence=confidence,
                    created_at=created_at_str,
                )

        self._with_retry(_run)

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    def get_node(self, concept_id: str) -> Optional[ConceptNode]:
        """Return the ConceptNode with the given concept_id, or None."""
        cypher = "MATCH (c:Concept {concept_id: $id}) RETURN c"
        with self.driver.session() as session:
            result = session.run(cypher, id=concept_id)
            record = result.single()
            if record is None:
                return None
            return self._record_to_node(record["c"])

    def get_all_nodes(self, skip: int = 0, limit: int = 500) -> List[ConceptNode]:
        """Return a paginated list of all ConceptNodes."""
        cypher = "MATCH (c:Concept) RETURN c SKIP $skip LIMIT $limit"
        with self.driver.session() as session:
            result = session.run(cypher, skip=skip, limit=limit)
            return [self._record_to_node(record["c"]) for record in result]

    def get_neighbourhood(self, concept_id: str, hops: int = 2) -> dict:
        """
        Return all nodes and edges within *hops* relationship steps of the
        given concept.

        Returns::

            {
                "nodes": [ConceptNode, ...],
                "edges": [{"source_id": ..., "target_id": ...,
                           "type": ..., "confidence": ..., "created_at": ...}, ...]
            }
        """
        # Variable-length path pattern; hops is injected as a literal since
        # Neo4j does not allow parameterised range bounds in this position.
        cypher = (
            f"MATCH (c:Concept {{concept_id: $id}})-[r*1..{int(hops)}]-(n:Concept) "
            f"RETURN c, r, n"
        )

        nodes_map: dict[str, ConceptNode] = {}
        edges: list[dict] = []
        seen_edge_ids: set = set()

        with self.driver.session() as session:
            # Seed with the root node
            root = self.get_node(concept_id)
            if root:
                nodes_map[concept_id] = root

            result = session.run(cypher, id=concept_id)
            for record in result:
                # Neighbour node
                neighbour = self._record_to_node(record["n"])
                nodes_map[neighbour.concept_id] = neighbour

                # Path segments (r is a list of relationships)
                for rel in record["r"]:
                    rel_id = rel.element_id
                    if rel_id not in seen_edge_ids:
                        seen_edge_ids.add(rel_id)
                        edges.append(
                            {
                                "source_id": rel.start_node["concept_id"],
                                "target_id": rel.end_node["concept_id"],
                                "type": rel.type,
                                "confidence": rel.get("confidence", 0.0),
                                "created_at": rel.get("created_at"),
                            }
                        )

        return {"nodes": list(nodes_map.values()), "edges": edges}

    def get_stats(self) -> dict:
        """Return aggregate statistics: node count, edge count, domain breakdown."""
        with self.driver.session() as session:
            node_count = session.run(
                "MATCH (c:Concept) RETURN count(c) AS n"
            ).single()["n"]

            edge_count = session.run(
                "MATCH ()-[r]->() RETURN count(r) AS e"
            ).single()["e"]

            domain_result = session.run(
                "MATCH (c:Concept) RETURN c.domain AS domain, count(c) AS cnt"
            )
            domains = {rec["domain"]: rec["cnt"] for rec in domain_result}

        return {
            "node_count": node_count,
            "edge_count": edge_count,
            "domains": domains,
        }

    # ------------------------------------------------------------------
    # Delete operations
    # ------------------------------------------------------------------

    def delete_node(self, concept_id: str) -> dict:
        """
        Delete a single ConceptNode and all its relationships.

        Returns ``{"nodes_deleted": n, "edges_deleted": e}``.
        """
        cypher = """
            MATCH (c:Concept {concept_id: $id})
            WITH c, size([(c)-[r]-() | r]) AS edge_count
            DETACH DELETE c
            RETURN edge_count
        """
        with self.driver.session() as session:
            result = session.run(cypher, id=concept_id)
            record = result.single()
            edges_deleted = record["edge_count"] if record else 0
            nodes_deleted = 1 if record else 0

        return {"nodes_deleted": nodes_deleted, "edges_deleted": edges_deleted}

    def delete_by_source(self, source_url: str) -> dict:
        """
        Delete all ConceptNodes whose ``source_url`` matches and all their
        connected edges.

        Returns ``{"nodes_deleted": n, "edges_deleted": e}``.
        """
        cypher = """
            MATCH (c:Concept {source_url: $url})
            WITH collect(c) AS nodes,
                 sum(size([(c)-[r]-() | r])) AS total_edges
            UNWIND nodes AS c
            DETACH DELETE c
            RETURN size(nodes) AS node_count, total_edges
        """
        with self.driver.session() as session:
            result = session.run(cypher, url=source_url)
            record = result.single()
            if record:
                return {
                    "nodes_deleted": record["node_count"],
                    "edges_deleted": record["total_edges"],
                }
            return {"nodes_deleted": 0, "edges_deleted": 0}

    # ------------------------------------------------------------------
    # Graph algorithms
    # ------------------------------------------------------------------

    def compute_pagerank(self) -> int:
        """
        Compute a PageRank approximation for every Concept node using
        degree centrality (in-degree + out-degree weighted).

        Uses pure Cypher to avoid requiring the Neo4j GDS plugin.
        Updates the ``importance_score`` property on each node.

        Returns the number of nodes updated.
        """
        cypher = """
            MATCH (c:Concept)
            OPTIONAL MATCH (c)-[r]-()
            WITH c, count(DISTINCT r) AS degree
            WITH collect({node: c, degree: degree}) AS data,
                 max(CASE WHEN count(DISTINCT r) > 0 THEN count(DISTINCT r) ELSE 1 END) AS max_degree
            UNWIND data AS d
            SET d.node.importance_score = round(toFloat(d.degree) / max_degree, 4)
            RETURN count(d) AS updated
        """
        # Fallback: simpler query that avoids aggregation issues
        count_cypher = """
            MATCH (c:Concept)
            OPTIONAL MATCH (c)-[r]-()
            WITH c, count(r) AS degree
            SET c.importance_score = CASE
                WHEN degree = 0 THEN 0.0
                ELSE round(toFloat(degree) / 10.0, 4)
            END
            RETURN count(c) AS updated
        """
        try:
            with self.driver.session() as session:
                result = session.run(count_cypher)
                record = result.single()
                updated = record["updated"] if record else 0
            logger.info(
                "compute_pagerank: updated %d nodes",
                updated,
                extra={"component": "graph_db"},
            )
            return updated
        except Exception as exc:
            logger.error(
                "compute_pagerank failed: %s", exc,
                extra={"component": "graph_db"},
            )
            return 0

    def detect_communities(self) -> int:
        """
        Detect communities using connected components via pure Cypher.

        Assigns a ``community_id`` property to each node based on the
        smallest concept_id in its connected component (label propagation
        approximation without GDS).

        Returns the number of nodes updated.
        """
        # Assign each node its own concept_id as initial community_id,
        # then propagate the minimum across connected components.
        init_cypher = """
            MATCH (c:Concept)
            SET c.community_id = c.concept_id
            RETURN count(c) AS n
        """
        propagate_cypher = """
            MATCH (a:Concept)-[]->(b:Concept)
            WHERE a.community_id < b.community_id
            SET b.community_id = a.community_id
            RETURN count(b) AS propagated
        """
        try:
            with self.driver.session() as session:
                result = session.run(init_cypher)
                total = result.single()["n"]

                # Iterate propagation until convergence (max 50 rounds)
                for _ in range(50):
                    result = session.run(propagate_cypher)
                    propagated = result.single()["propagated"]
                    if propagated == 0:
                        break

            logger.info(
                "detect_communities: community labels set for %d nodes",
                total,
                extra={"component": "graph_db"},
            )
            return total
        except Exception as exc:
            logger.error(
                "detect_communities failed: %s", exc,
                extra={"component": "graph_db"},
            )
            return 0

    def get_fading_nodes(self, threshold: float = 0.7) -> List[ConceptNode]:
        """Return all nodes whose forget_score exceeds the given threshold."""
        cypher = "MATCH (c:Concept) WHERE c.forget_score > $threshold RETURN c"
        with self.driver.session() as session:
            result = session.run(cypher, threshold=threshold)
            return [self._record_to_node(record["c"]) for record in result]

    def batch_update_forget_scores(self, updates: list) -> int:
        """
        Batch-update forget_score values for multiple nodes.

        Args:
            updates: List of dicts ``{concept_id, forget_score}``.

        Returns the number of nodes updated.
        """
        cypher = """
            UNWIND $updates AS u
            MATCH (c:Concept {concept_id: u.concept_id})
            SET c.forget_score = u.forget_score
            RETURN count(c) AS updated
        """
        with self.driver.session() as session:
            result = session.run(cypher, updates=updates)
            record = result.single()
            return record["updated"] if record else 0

    def update_node_sm2_fields(self, concept_id: str, sm2_data: dict) -> None:
        """Update SM-2 fields on a node after a review event."""
        cypher = """
            MATCH (c:Concept {concept_id: $id})
            SET c.ease_factor  = $ease_factor,
                c.rep_interval = $rep_interval,
                c.rep_count    = $rep_count,
                c.last_seen    = $last_seen
        """
        with self.driver.session() as session:
            session.run(
                cypher,
                id=concept_id,
                ease_factor=sm2_data["ease_factor"],
                rep_interval=sm2_data["rep_interval"],
                rep_count=sm2_data["rep_count"],
                last_seen=sm2_data["last_seen"],
            )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying Neo4j driver and release resources."""
        self.driver.close()
        logger.info("Neo4j driver closed", extra={"component": "graph_db"})

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _record_to_node(node_data) -> ConceptNode:
        """Convert a raw Neo4j node mapping to a ConceptNode Pydantic model."""
        props = dict(node_data)
        return ConceptNode(
            concept_id=props["concept_id"],
            name=props["name"],
            domain=props["domain"],
            summary=props["summary"],
            source_url=props["source_url"],
            created_at=props["created_at"],
            last_seen=props["last_seen"],
            ease_factor=float(props.get("ease_factor", 2.5)),
            rep_interval=int(props.get("rep_interval", 1)),
            rep_count=int(props.get("rep_count", 0)),
            forget_score=float(props.get("forget_score", 0.0)),
        )

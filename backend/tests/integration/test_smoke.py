"""
test_smoke.py — Integration smoke test for the FastAPI health endpoint.

Tests that GET /health returns 200 with the expected JSON structure,
using mocks for all downstream services so no real Docker containers
are required to run this test.

Requirements: 27.1 (health endpoint), 24.4 (pipeline status visible)
"""

import os
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_services():
    """Patch all three service constructors so they return lightweight mocks."""
    neo4j_mock = MagicMock()
    neo4j_mock.get_stats.return_value = {"node_count": 0, "edge_count": 0, "domains": {}}
    neo4j_mock.init_schema.return_value = None
    neo4j_mock.close.return_value = None

    vector_db_mock = MagicMock()
    vector_db_mock.similarity_search.return_value = []

    groq_mock = MagicMock()

    with (
        patch("backend.main.Neo4jService", return_value=neo4j_mock),
        patch("backend.main.VectorDBService", return_value=vector_db_mock),
        patch("backend.main.GroqClient", return_value=groq_mock),
        patch.dict(os.environ, {"GROQ_API_KEY": "test-key", "PSB_API_KEY": "test-psb-key"}),
    ):
        yield neo4j_mock, vector_db_mock, groq_mock


@pytest.fixture
def client(mock_services):
    """Create a TestClient with all services mocked."""
    from backend.main import app

    with TestClient(app) as test_client:
        yield test_client


class TestHealthEndpoint:
    """Smoke tests for GET /health."""

    def test_health_returns_200(self, client):
        """Health endpoint must return HTTP 200."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_response_has_status_ok(self, client):
        """Response body must contain status=ok."""
        response = client.get("/health")
        body = response.json()
        assert body["status"] == "ok"

    def test_health_response_has_version(self, client):
        """Response body must contain a version string."""
        response = client.get("/health")
        body = response.json()
        assert "version" in body
        assert body["version"] == "1.0.0"

    def test_health_response_has_services_key(self, client):
        """Response body must contain a services key with all three services."""
        response = client.get("/health")
        body = response.json()
        assert "services" in body
        services = body["services"]
        assert "neo4j" in services
        assert "chromadb" in services
        assert "groq" in services

    def test_health_neo4j_connected_when_service_ok(self, client):
        """neo4j status should be 'connected' when get_stats() succeeds."""
        response = client.get("/health")
        body = response.json()
        assert body["services"]["neo4j"] == "connected"

    def test_health_chromadb_connected_when_service_ok(self, client):
        """chromadb status should be 'connected' when similarity_search() succeeds."""
        response = client.get("/health")
        body = response.json()
        assert body["services"]["chromadb"] == "connected"

    def test_health_groq_configured_when_key_set(self, client):
        """groq status should be 'configured' when GROQ_API_KEY env var is set."""
        response = client.get("/health")
        body = response.json()
        assert body["services"]["groq"] == "configured"

    def test_health_neo4j_unavailable_when_service_fails(self, mock_services, monkeypatch):
        """neo4j status should be 'unavailable' when get_stats() raises."""
        neo4j_mock, _, _ = mock_services
        neo4j_mock.get_stats.side_effect = Exception("Connection refused")

        from backend.main import app
        with TestClient(app) as test_client:
            response = test_client.get("/health")
        body = response.json()
        assert body["services"]["neo4j"] == "unavailable"
        assert body["status"] == "ok"  # overall status still ok — partial degradation

    def test_health_docs_accessible(self, client):
        """Swagger UI at /docs must be reachable."""
        response = client.get("/docs")
        assert response.status_code == 200


class TestSwaggerDocs:
    """Verify that the OpenAPI spec is generated correctly."""

    def test_openapi_schema_accessible(self, client):
        """OpenAPI JSON must be accessible at /openapi.json."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert schema["info"]["title"] == "Passive Second Brain API"
        assert "paths" in schema
        assert "/health" in schema["paths"]

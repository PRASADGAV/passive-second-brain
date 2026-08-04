"""
gaps.py — Knowledge gap analysis REST API router for Passive Second Brain.

Endpoints:
  POST /gaps — analyse a job description and identify skill gaps

Requirements:
    19.2 Extract skills via LLM
    19.3 Cross-reference graph
    19.6 Message if no skills found
"""

import html
import json
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

try:
    from backend.auth import verify_api_key
    from backend.prompts.gaps import SKILL_EXTRACTION_SYSTEM_PROMPT
except ModuleNotFoundError:
    from auth import verify_api_key
    from prompts.gaps import SKILL_EXTRACTION_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

router = APIRouter(tags=["gaps"])


class GapRequest(BaseModel):
    job_description: str


@router.post(
    "/gaps",
    summary="Analyse skill gaps for a job description",
    dependencies=[Depends(verify_api_key)],
)
async def analyse_gaps(body: GapRequest, request: Request) -> dict:
    """
    Extract required skills from a job description, cross-reference
    them against the knowledge graph, and return a gap report.
    """
    if not body.job_description or not body.job_description.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="job_description must be a non-empty string.",
        )

    # Security: strip HTML tags from input before LLM call
    clean_text = html.escape(body.job_description.strip())
    clean_text = re.sub(r'<[^>]+>', '', clean_text)

    # Step 1: Extract skills via LLM
    try:
        raw_response = request.app.state.groq.call(
            SKILL_EXTRACTION_SYSTEM_PROMPT,
            clean_text,
        )

        # Parse JSON response
        skills = []
        try:
            parsed = json.loads(raw_response)
            skills = parsed.get("skills", [])
        except json.JSONDecodeError:
            # Try to extract skills from malformed response
            logger.warning("gaps: LLM returned non-JSON response, attempting extraction")
            # Fallback: split by newlines/commas
            skills = [s.strip().strip('-').strip('•').strip()
                       for s in re.split(r'[,\n]', raw_response)
                       if s.strip() and len(s.strip()) < 100]

        if not skills:
            return {
                "present_skills": [],
                "missing_skills": [],
                "message": "Could not extract any skills from the job description.",
            }

    except Exception as exc:
        logger.error("gaps: LLM call failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to extract skills from job description.",
        )

    # Step 2: Cross-reference each skill against the knowledge graph
    present_skills = []
    missing_skills = []

    for skill in skills[:30]:  # Limit to 30 skills
        skill_name = str(skill).strip()[:100]
        if not skill_name:
            continue

        # Search via ChromaDB similarity
        try:
            matches = request.app.state.vector_db.similarity_search(skill_name, top_k=1)
            if matches:
                # Verify the match is actually relevant by fetching the node
                node = request.app.state.neo4j.get_node(matches[0])
                if node:
                    present_skills.append({
                        "skill": skill_name,
                        "concept_id": node.concept_id,
                        "forget_score": node.forget_score,
                        "name": node.name,
                    })
                    continue
        except Exception as exc:
            logger.warning("gaps: search failed for skill '%s': %s", skill_name, exc)

        missing_skills.append(skill_name)

    logger.info(
        "gaps: analysis complete — %d present, %d missing",
        len(present_skills), len(missing_skills),
    )

    return {
        "present_skills": present_skills,
        "missing_skills": missing_skills,
    }

"""
playground.py — Groq prompt playground router for Passive Second Brain.

Endpoints:
  POST /playground         — test a system prompt against sample text using Groq
  GET  /playground/prompts — load current prompt texts
  POST /playground/prompts — save/overwrite prompt texts to the Python prompt files

Requirements:
  28.1 Guarded by DEVELOPER_MODE=true env check (returns 403 otherwise)
  28.2 Returns raw JSON/text response, token usage, and latency
  28.3 Edit extract.py, digest.py, and gaps.py prompts
  28.4 Persist changes on save
  28.5 Token usage and latency visible
"""

import logging
import os
import time
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from pathlib import Path

try:
    from backend.auth import verify_api_key
except ModuleNotFoundError:
    from auth import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/playground", tags=["playground"])


def verify_developer_mode():
    """Verify that DEVELOPER_MODE is enabled in the environment."""
    dev_mode = os.getenv("DEVELOPER_MODE", "false").lower() == "true"
    if not dev_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Playground is only accessible in DEVELOPER_MODE."
        )


class PlaygroundRequest(BaseModel):
    prompt: str
    sample_text: str


class SavePromptRequest(BaseModel):
    type: str # "extract" | "digest" | "gaps"
    prompt: str


@router.post(
    "",
    summary="Test prompt in playground",
    dependencies=[Depends(verify_api_key), Depends(verify_developer_mode)],
)
async def test_prompt(body: PlaygroundRequest, request: Request) -> dict:
    """Run a prompt test against a sample text using Groq."""
    try:
        t_start = time.time()
        response = request.app.state.groq.client.chat.completions.create(
            model=request.app.state.groq.model,
            messages=[
                {"role": "system", "content": body.prompt},
                {"role": "user", "content": body.sample_text},
            ],
            temperature=0.1,
        )
        latency_ms = (time.time() - t_start) * 1000
        
        raw_response = response.choices[0].message.content
        usage = response.usage
        
        return {
            "raw_response": raw_response,
            "token_usage": {
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.total_tokens,
            },
            "latency_ms": round(latency_ms, 2),
        }
    except Exception as exc:
        logger.error("playground: Groq call failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Groq API call failed: {exc}"
        )


@router.get(
    "/prompts",
    summary="Get all dynamic prompts",
    dependencies=[Depends(verify_api_key), Depends(verify_developer_mode)],
)
async def get_prompts() -> dict:
    """Load the current dynamic system prompts from the files."""
    prompts = {}
    
    # 1. Extract prompt
    try:
        from backend.prompts.extract import CONCEPT_EXTRACTION_SYSTEM_PROMPT
        prompts["extract"] = CONCEPT_EXTRACTION_SYSTEM_PROMPT
    except Exception:
        prompts["extract"] = ""
        
    # 2. Digest prompt
    try:
        from backend.prompts.digest import DIGEST_GENERATION_SYSTEM_PROMPT
        prompts["digest"] = DIGEST_GENERATION_SYSTEM_PROMPT
    except Exception:
        prompts["digest"] = ""
        
    # 3. Gaps prompt
    try:
        from backend.prompts.gaps import SKILL_EXTRACTION_SYSTEM_PROMPT
        prompts["gaps"] = SKILL_EXTRACTION_SYSTEM_PROMPT
    except Exception:
        prompts["gaps"] = ""

    return prompts


@router.post(
    "/prompts",
    summary="Save dynamic system prompt to file",
    dependencies=[Depends(verify_api_key), Depends(verify_developer_mode)],
)
async def save_prompt(body: SavePromptRequest) -> dict:
    """Overwrite the prompt constants on disk to persist them."""
    if body.type not in ["extract", "digest", "gaps"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Type must be one of 'extract', 'digest', or 'gaps'."
        )
        
    prompt_dir = Path("backend") / "prompts"
    if not prompt_dir.exists():
        prompt_dir.mkdir(parents=True, exist_ok=True)
        
    file_path = prompt_dir / f"{body.type}.py"
    
    try:
        # Write files preserving key structure
        if body.type == "extract":
            content = (
                f'"""\nextract.py — LLM prompts for concept and relationship extraction.\n"""\n\n'
                f'CONCEPT_EXTRACTION_SYSTEM_PROMPT = """{body.prompt}"""\n'
            )
        elif body.type == "digest":
            content = (
                f'"""\ndigest.py — LLM prompt for daily learning digest generation.\n"""\n\n'
                f'DIGEST_GENERATION_SYSTEM_PROMPT = """{body.prompt}"""\n'
            )
        elif body.type == "gaps":
            # For gaps.py, we also preserve the default GAP_ANALYSIS_SYSTEM_PROMPT
            gap_analysis_default = (
                'GAP_ANALYSIS_SYSTEM_PROMPT = """You are a career advisor. Given a list of '
                'required skills for a job and a list of skills the user already knows, generate '
                'a short personalised study plan for the missing skills.\\n\\nRULES:\\n- Prioritise '
                'the most impactful missing skills first\\n- For each missing skill, suggest one '
                'specific resource or learning approach in one sentence\\n- Be concise — maximum '
                '150 words total\\n- Write in second person ("Focus on...", "Start with...", '
                '"Learn...")\\n\\nRESPOND ONLY WITH PLAIN TEXT. No JSON. No markdown."""'
            )
            content = (
                f'"""\ngaps.py — LLM prompts for knowledge gap analysis.\n"""\n\n'
                f'SKILL_EXTRACTION_SYSTEM_PROMPT = """{body.prompt}"""\n\n'
                f'{gap_analysis_default}\n'
            )
            
        file_path.write_text(content, encoding="utf-8")
        logger.info("playground: saved prompt file %s", file_path)
        return {"status": "success", "message": f"{body.type} prompt saved successfully."}
    except Exception as exc:
        logger.error("playground: failed to save prompt: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write prompt file: {exc}"
        )

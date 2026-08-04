from pydantic import BaseModel, Field, UUID4
from datetime import datetime, date
from enum import Enum
from typing import Optional, List


class SourceType(str, Enum):
    webpage = "webpage"
    youtube = "youtube"
    pdf     = "pdf"
    voice   = "voice"
    text    = "text"


class CaptureStatus(str, Enum):
    pending    = "pending"
    processing = "processing"
    completed  = "completed"
    failed     = "failed"


class EdgeType(str, Enum):
    IS_PREREQUISITE_FOR = "IS_PREREQUISITE_FOR"
    IS_SUBSET_OF        = "IS_SUBSET_OF"
    EXTENDS             = "EXTENDS"
    CONTRADICTS         = "CONTRADICTS"
    IS_USED_IN          = "IS_USED_IN"
    CO_OCCURS_WITH      = "CO_OCCURS_WITH"


class CaptureItem(BaseModel):
    id:           UUID4
    source_type:  SourceType
    source_url:   str
    raw_text:     str
    captured_at:  datetime
    status:       CaptureStatus = CaptureStatus.pending
    domain:       Optional[str] = None


class ConceptNode(BaseModel):
    concept_id:   str = Field(..., description="UUID string")
    name:         str = Field(..., max_length=200)
    domain:       str
    summary:      str = Field(..., max_length=500)
    source_url:   str
    created_at:   datetime
    last_seen:    datetime
    ease_factor:  float = Field(2.5, ge=1.3, le=5.0)
    rep_interval: int   = Field(1, ge=1)
    rep_count:    int   = Field(0, ge=0)
    forget_score: float = Field(0.0, ge=0.0, le=1.0)


class Edge(BaseModel):
    source_id:  str
    target_id:  str
    type:       EdgeType
    confidence: float = Field(..., ge=0.0, le=1.0)
    created_at: datetime


class DigestEntry(BaseModel):
    date:               date
    new_concepts_count: int
    new_edges_count:    int
    domains_covered:    List[str]
    fading_concepts:    List[str]   # list of concept_ids
    summary_text:       str


class RAGResult(BaseModel):
    answer:    str
    citations: List[dict]           # [{node_id, name, source_url}]


class GapReport(BaseModel):
    present_skills: List[dict]      # [{skill, concept_id, forget_score}]
    missing_skills: List[str]

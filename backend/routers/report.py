"""
report.py — Weekly report PDF generation router for Passive Second Brain.

Endpoints:
  GET /report/weekly — Generate and download a weekly progress report PDF

Requirements:
  20.1 (weekly report download control)
  20.2 (7-day stats formatted in PDF, new concepts chart, top-10 concepts, domains covered, fading concepts)
  20.3 (file naming: psb-weekly-report-YYYY-MM-DD.pdf)
  20.4 (error handling: return 500/error message on PDF generation failure)
"""

import io
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from fpdf import FPDF

try:
    from backend.auth import verify_api_key
except ModuleNotFoundError:
    from auth import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/report", tags=["report"])


class WeeklyReportPDF(FPDF):
    """Custom FPDF subclass for generating beautiful weekly reports."""

    def __init__(self, start_date: str, end_date: str):
        super().__init__()
        self.start_date = start_date
        self.end_date = end_date

    def header(self):
        # Top banner background
        self.set_fill_color(99, 102, 241) # Indigo primary
        self.rect(0, 0, 210, 30, 'F')

        # Header Title
        self.set_text_color(255, 255, 255)
        self.set_font('Helvetica', 'B', 16)
        self.set_xy(10, 10)
        self.cell(0, 10, 'Passive Second Brain', border=0, ln=1)

        # Header Subtitle
        self.set_font('Helvetica', 'I', 10)
        self.set_xy(10, 18)
        self.cell(0, 5, f'Weekly Knowledge Report ({self.start_date} to {self.end_date})', border=0, ln=1)

        self.set_text_color(55, 65, 81) # Default dark grey text
        self.set_y(35)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(156, 163, 175) # Muted text
        # Date & Time Generated
        gen_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        self.cell(100, 10, f'Generated at {gen_time}', border=0, align='L')
        # Page number
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', border=0, align='R')


@router.get(
    "/weekly",
    summary="Download weekly knowledge report as PDF",
    dependencies=[Depends(verify_api_key)],
)
async def get_weekly_report(request: Request):
    """
    Generate and stream a weekly knowledge report PDF containing:
    - New concepts per day bar chart (past 7 days)
    - Top-10 concepts by edge count (degree centrality)
    - Unique domains covered
    - Concepts currently fading/requiring review (forget_score > 0.7)
    """
    try:
        now = datetime.now(timezone.utc)
        start_time = now - timedelta(days=7)
        start_date_str = start_time.strftime('%Y-%m-%d')
        end_date_str = now.strftime('%Y-%m-%d')

        # ── 1. Fetch data from Neo4j ──
        # We run the session queries directly using the application's neo4j service
        neo4j_svc = request.app.state.neo4j

        # Get all concepts created in the last 7 days for the daily ingestion bar chart
        cypher_new_concepts = """
            MATCH (c:Concept)
            WHERE c.created_at >= $start_time
            RETURN c.created_at AS created_at, c.name AS name, c.domain AS domain
        """

        # Get top-10 concepts by edge count
        cypher_top_concepts = """
            MATCH (c:Concept)
            OPTIONAL MATCH (c)-[r]-()
            RETURN c.concept_id AS concept_id, c.name AS name, c.domain AS domain, count(r) AS edge_count
            ORDER BY edge_count DESC, name ASC
            LIMIT 10
        """

        # Get fading concepts (forget_score > 0.7)
        cypher_fading_concepts = """
            MATCH (c:Concept)
            WHERE c.forget_score > 0.7
            RETURN c.name AS name, c.domain AS domain, c.forget_score AS forget_score
            ORDER BY c.forget_score DESC
            LIMIT 20
        """

        with neo4j_svc.driver.session() as session:
            # Query 1: New concepts
            res_new = session.run(cypher_new_concepts, start_time=start_time.isoformat())
            new_concepts = [dict(record) for record in res_new]

            # Query 2: Top concepts
            res_top = session.run(cypher_top_concepts)
            top_concepts = [dict(record) for record in res_top]

            # Query 3: Fading concepts
            res_fading = session.run(cypher_fading_concepts)
            fading_concepts = [dict(record) for record in res_fading]

        # Calculate daily counts for the last 7 days
        days = [(now - timedelta(days=i)).date() for i in range(6, -1, -1)]
        daily_counts = {d: 0 for d in days}
        unique_domains = set()

        for concept in new_concepts:
            created_at_str = concept.get("created_at", "")
            if created_at_str:
                try:
                    c_date = datetime.fromisoformat(created_at_str).date()
                    if c_date in daily_counts:
                        daily_counts[c_date] += 1
                except Exception:
                    pass
            domain = concept.get("domain")
            if domain:
                unique_domains.add(domain)

        # ── 2. Construct PDF report ──
        pdf = WeeklyReportPDF(start_date_str, end_date_str)
        pdf.alias_nb_pages()
        pdf.add_page()

        # ── Executive Summary ──
        pdf.set_font('Helvetica', 'B', 14)
        pdf.cell(0, 10, 'Executive Summary', ln=1)
        pdf.set_font('Helvetica', '', 10)
        total_ingested = len(new_concepts)
        pdf.multi_cell(0, 6, (
            f"Over the last 7 days, your Passive Second Brain captured and integrated a total of "
            f"{total_ingested} new concept(s) across {len(unique_domains)} distinct domain(s). "
            f"There are currently {len(fading_concepts)} concept(s) requiring attention or review."
        ))
        pdf.ln(4)

        # ── Ingestion Bar Chart ──
        pdf.set_font('Helvetica', 'B', 12)
        pdf.cell(0, 8, 'Daily Ingestion Rate (Past 7 Days)', ln=1)

        # Draw a custom bar chart using PDF shapes
        chart_x = 30
        chart_y = 65
        chart_w = 150
        chart_h = 45

        # Draw chart border
        pdf.set_draw_color(229, 231, 235) # Light grey border
        pdf.line(chart_x, chart_y + chart_h, chart_x + chart_w, chart_y + chart_h) # X-axis

        max_count = max(list(daily_counts.values()) + [1])
        bar_w = 12
        spacing = (chart_w - (bar_w * 7)) / 8

        pdf.set_fill_color(99, 102, 241) # Indigo primary fill
        pdf.set_text_color(107, 114, 128) # Grey text

        for idx, (day, count) in enumerate(daily_counts.items()):
            bar_x = chart_x + spacing + idx * (bar_w + spacing)
            # Calculate height proportional to count
            bar_h = (count / max_count) * (chart_h - 10)
            bar_y = chart_y + chart_h - bar_h

            # Draw bar rect
            if count > 0:
                pdf.rect(bar_x, bar_y, bar_w, bar_h, 'F')

            # Draw bar value above bar
            pdf.set_font('Helvetica', 'B', 8)
            pdf.set_xy(bar_x - 2, bar_y - 4)
            pdf.cell(bar_w + 4, 3, str(count), border=0, align='C')

            # Draw date label below X-axis
            pdf.set_font('Helvetica', '', 7)
            pdf.set_xy(bar_x - 5, chart_y + chart_h + 2)
            pdf.cell(bar_w + 10, 4, day.strftime('%a %d'), border=0, align='C')

        pdf.set_text_color(55, 65, 81) # Reset text color
        pdf.set_y(chart_y + chart_h + 12)

        # ── Top-10 Concepts Table ──
        pdf.set_font('Helvetica', 'B', 12)
        pdf.cell(0, 8, 'Top Connected Concepts', ln=1)

        # Table Header
        pdf.set_font('Helvetica', 'B', 9)
        pdf.set_fill_color(243, 244, 246) # Light grey bg
        pdf.cell(15, 7, 'Rank', border=1, fill=True, align='C')
        pdf.cell(100, 7, 'Concept Name', border=1, fill=True, align='L')
        pdf.cell(50, 7, 'Domain', border=1, fill=True, align='L')
        pdf.cell(25, 7, 'Connections', border=1, fill=True, align='C')
        pdf.ln()

        pdf.set_font('Helvetica', '', 9)
        for idx, concept in enumerate(top_concepts, 1):
            name = concept.get("name", "Unknown")[:50]
            domain = concept.get("domain", "General")[:25]
            edge_count = concept.get("edge_count", 0)

            # Alternate row background
            bg = (idx % 2 == 0)
            pdf.set_fill_color(249, 250, 251) if bg else pdf.set_fill_color(255, 255, 255)

            pdf.cell(15, 6, str(idx), border=1, fill=True, align='C')
            pdf.cell(100, 6, name, border=1, fill=True, align='L')
            pdf.cell(50, 6, domain, border=1, fill=True, align='L')
            pdf.cell(25, 6, str(edge_count), border=1, fill=True, align='C')
            pdf.ln()

        pdf.ln(4)

        # ── Fading Concepts Section ──
        if fading_concepts:
            # Let's check page break space
            if pdf.get_y() > 220:
                pdf.add_page()

            pdf.set_font('Helvetica', 'B', 12)
            pdf.cell(0, 8, 'Fading Concepts (Requires Spaced Review)', ln=1)

            # Table Header
            pdf.set_font('Helvetica', 'B', 9)
            pdf.set_fill_color(243, 244, 246)
            pdf.cell(100, 7, 'Concept Name', border=1, fill=True, align='L')
            pdf.cell(50, 7, 'Domain', border=1, fill=True, align='L')
            pdf.cell(40, 7, 'Forget Score', border=1, fill=True, align='C')
            pdf.ln()

            pdf.set_font('Helvetica', '', 9)
            for idx, concept in enumerate(fading_concepts, 1):
                name = concept.get("name", "Unknown")[:50]
                domain = concept.get("domain", "General")[:25]
                score = concept.get("forget_score", 0.0)

                bg = (idx % 2 == 0)
                pdf.set_fill_color(249, 250, 251) if bg else pdf.set_fill_color(255, 255, 255)

                pdf.cell(100, 6, name, border=1, fill=True, align='L')
                pdf.cell(50, 6, domain, border=1, fill=True, align='L')
                pdf.cell(40, 6, f"{score:.4f}", border=1, fill=True, align='C')
                pdf.ln()

        # Output the PDF to an in-memory buffer
        pdf_bytes = bytes(pdf.output())
        pdf_buffer = io.BytesIO(pdf_bytes)

        filename = f"psb-weekly-report-{end_date_str}.pdf"

        return StreamingResponse(
            pdf_buffer,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-cache"
            }
        )

    except Exception as exc:
        logger.error(
            "report: failed to generate weekly report PDF: %s",
            exc,
            exc_info=True,
            extra={"component": "report"}
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while generating the weekly PDF report."
        )

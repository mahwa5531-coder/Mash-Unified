# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Native Statutory Audit Skills Tool for NexAU.

Enables on-demand retrieval of 73 Indian Statutory Audit skills across 17 domains:
- SA Standards (ICAI Standards on Auditing)
- CARO 2020 verification checklists
- Companies Act 2013 Schedule III compliance
- Ind AS / AS accounting standards & disclosures
- Statistical & Mathematical audit algorithms (MUS, Benford, Sampling)
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.main_sub.framework_context import FrameworkContext

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).resolve().parent / "procedures"


def _index_skills() -> dict[str, Path]:
    """Map skill slugs to file paths."""
    skill_map: dict[str, Path] = {}
    if not SKILLS_DIR.exists():
        return skill_map

    for md_file in SKILLS_DIR.rglob("*.md"):
        slug = md_file.stem.lower()
        skill_map[slug] = md_file
        skill_map[slug.replace("-", "_")] = md_file
    return skill_map


def audit_skill_tool(
    action: str,
    skill_name: str | None = None,
    domain: str | None = None,
    query: str | None = None,
    agent_state: AgentState | None = None,
    ctx: FrameworkContext | None = None,
) -> dict[str, Any]:
    """Execute statutory audit skill lookup, retrieval, or searching."""
    if not action or not action.strip():
        return {
            "content": "Error: 'action' parameter is required. Available actions: 'get_skill', 'list_skills', 'search_skills', 'get_guide'.",
            "returnDisplay": "Error: Missing action.",
            "error": {"message": "Missing action", "type": "INVALID_ARGUMENT"},
        }

    action_clean = action.strip().lower()
    skills_index = _index_skills()

    # --------------------------------------------------------------------------
    # ACTION: get_guide
    # --------------------------------------------------------------------------
    if action_clean in ["get_guide", "guide"]:
        guide_text = (
            "# Indian Statutory Audit Skills — Master Navigation Guide\n\n"
            "This repository contains 73 specialized audit procedures across 17 domains:\n"
            "1. `01-engagement-and-planning`: Materiality (SA 320), Risk Assessment (SA 315), Sampling, Trial Balance.\n"
            "2. `02-revenue-and-receivables`: Cut-off, AR Confirmation (SA 505), Revenue Recognition (Ind AS 115).\n"
            "3. `03-procurement-and-payables`: Accounts Payable, 3-Way Match, Purchase Cut-off.\n"
            "4. `04-inventory`: Physical Verification (SA 501), Inventory Valuation, NRV Testing.\n"
            "5. `05-fixed-assets`: Additions, Disposals, Depreciation (Schedule II), CWIP Ageing.\n"
            "6. `06-cash-and-bank`: Bank Reconciliation (BRS), Bank Confirmations, Cash Ceiling.\n"
            "7. `07-investments-and-financial-instruments`: Ind AS 109 Fair Value, Impairment.\n"
            "8. `08-borrowings-and-finance`: Borrowing Covenants, ROC Charges, Interest Recalculation.\n"
            "9. `09-equity`: Share Capital, Reserves & Surplus, Dividend Compliance.\n"
            "10. `10-journal-entries`: Management Override, Weekend/Round-sum JE Testing (SA 240).\n"
            "11. `11-payroll-and-hr`: Statutory Dues (PF/ESI/PT), Actuarial Valuation (AS 15 / Ind AS 19).\n"
            "12. `12-taxation`: Income Tax Provision, GST GSTR-2B Reconciliation, Deferred Tax (AS 22).\n"
            "13. `13-provisions-and-estimates`: Accounting Estimates (SA 540), Contingent Liabilities.\n"
            "14. `14-compliance-and-related-parties`: Companies Act 2013, Section 188 Related Parties, CARO 2020.\n"
            "15. `15-special-areas`: Going Concern (SA 570), Subsequent Events (SA 560), Fraud Risk (SA 240).\n"
            "16. `16-completion-and-reporting`: Audit Reports (SA 700/705), Evaluation of Misstatements (SA 450).\n"
            "17. `17-mathematical-and-statistical-techniques`: Monetary Unit Sampling (MUS), Benford's Law, DCF, Fair Value.\n\n"
            "To retrieve any procedure, call: `audit_skill_tool(action=\'get_skill\', skill_name=\'<skill_slug>\')`."
        )
        return {
            "content": guide_text,
            "returnDisplay": "Loaded Statutory Audit Navigation Guide (73 Skills across 17 Domains)",
        }

    # --------------------------------------------------------------------------
    # ACTION: list_skills
    # --------------------------------------------------------------------------
    if action_clean in ["list_skills", "list_skill"]:
        if not SKILLS_DIR.exists():
            return {
                "content": "Error: Statutory audit skills directory not found.",
                "returnDisplay": "Error: Skills directory missing.",
            }

        domain_filter = domain.strip().lower() if domain else None
        domains_found: dict[str, list[str]] = {}

        for domain_folder in sorted(SKILLS_DIR.iterdir()):
            if not domain_folder.is_dir():
                continue
            d_name = domain_folder.name
            if domain_filter and domain_filter not in d_name.lower():
                continue

            skills_in_domain = [f.stem for f in sorted(domain_folder.glob("*.md"))]
            if skills_in_domain:
                domains_found[d_name] = skills_in_domain

        output_lines = [f"# Statutory Audit Skills Catalog ({len(skills_index) // 2} Procedures Available)\n"]
        for dom, sks in domains_found.items():
            output_lines.append(f"### Domain: `{dom}` ({len(sks)} skills)")
            for sk in sks:
                output_lines.append(f"- `{sk}`")
            output_lines.append("")

        content_str = "\n".join(output_lines)
        return {
            "content": content_str,
            "returnDisplay": f"Loaded Statutory Audit Skills Catalog ({len(skills_index) // 2} Skills)",
        }

    # --------------------------------------------------------------------------
    # ACTION: search_skills
    # --------------------------------------------------------------------------
    if action_clean in ["search_skills", "search_skill"]:
        if not query or not query.strip():
            return {
                "content": "Error: 'query' parameter is required for search_skills.",
                "returnDisplay": "Error: Missing search query.",
            }

        q_terms = [t.lower() for t in re.split(r"\s+", query.strip()) if len(t) > 2]
        matches: list[dict[str, Any]] = []

        seen_files = set()
        for slug, file_path in skills_index.items():
            if file_path in seen_files:
                continue
            seen_files.add(file_path)

            text = file_path.read_text(encoding="utf-8", errors="replace").lower()
            score = 0
            for term in q_terms:
                if term in slug:
                    score += 10
                score += text.count(term)

            if score > 0:
                domain_name = file_path.parent.name
                matches.append({
                    "skill_name": file_path.stem,
                    "domain": domain_name,
                    "score": score,
                })

        matches.sort(key=lambda x: x["score"], reverse=True)
        top_matches = matches[:10]

        if not top_matches:
            return {
                "content": f"No skills matched query '{query}'. Use action='list_skills' to view all available skills.",
                "returnDisplay": f"0 skills found for '{query}'",
            }

        output_lines = [f"# Search Results for '{query}':\n"]
        for m in top_matches:
            output_lines.append(f"- **`{m['skill_name']}`** (Domain: `{m['domain']}`) — Retrieve with: `audit_skill_tool(action=\'get_skill\', skill_name=\'{m['skill_name']}\')`")

        return {
            "content": "\n".join(output_lines),
            "returnDisplay": f"Found {len(top_matches)} matching skills for '{query}'",
            "results": top_matches,
        }

    # --------------------------------------------------------------------------
    # ACTION: get_skill
    # --------------------------------------------------------------------------
    if action_clean in ["get_skill", "get_skills"]:
        if not skill_name or not skill_name.strip():
            return {
                "content": "Error: 'skill_name' parameter is required. Use action='list_skills' or action='search_skills' to find skill names.",
                "returnDisplay": "Error: Missing skill_name.",
            }

        skill_clean = skill_name.strip().lower()
        matched_file = skills_index.get(skill_clean) or skills_index.get(skill_clean.replace("-", "_"))

        if not matched_file or not matched_file.exists():
            available_samples = ", ".join(f"'{k}'" for k in list(skills_index.keys())[:8])
            return {
                "content": f"Skill '{skill_name}' not found. Available examples: {available_samples}... Use action='search_skills' to find the exact name.",
                "returnDisplay": f"Error: Skill '{skill_name}' not found.",
                "error": {"message": f"Skill not found: {skill_name}", "type": "NOT_FOUND"},
            }

        content = matched_file.read_text(encoding="utf-8", errors="replace")
        return {
            "content": content,
            "returnDisplay": f"Loaded Statutory Audit Skill: {matched_file.stem} (Domain: {matched_file.parent.name})",
            "skill_name": matched_file.stem,
            "domain": matched_file.parent.name,
        }

    return {
        "content": f"Unknown action: '{action}'. Available actions: 'get_skill', 'list_skills', 'search_skills', 'get_guide'.",
        "returnDisplay": f"Unknown action: {action}",
        "error": {"message": f"Unknown action: {action}", "type": "INVALID_ARGUMENT"},
    }
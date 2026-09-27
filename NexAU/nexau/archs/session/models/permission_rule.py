# Permission rules model for tool permission management.
# RFC-0019:
# permission_rules allow/deny .
# Session tool YAML configuration source=config
# allow source=user .

from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class PermissionRuleModel(SQLModel, table=True):
    """Permission rule for a tool in a session.

    RFC-0019: permission_rules 

    key (user_id, session_id, tool_name, rule_content, behavior)
     session  tool . 
    """

    __tablename__ = "permission_rules"  # type: ignore[assignment]

    user_id: str = Field(primary_key=True)
    session_id: str = Field(primary_key=True)
    tool_name: str = Field(primary_key=True)
    rule_content: str = Field(primary_key=True)
    behavior: str = Field(primary_key=True)
    source: str = Field(default="config")
    created_at: datetime = Field(default_factory=datetime.now)
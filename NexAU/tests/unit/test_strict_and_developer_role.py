from __future__ import annotations

from nexau.archs.tool.tool import (
    StructuredToolDefinition,
    normalize_schema_for_strict,
    structured_tool_definition_to_openai,
)
from nexau.core.messages import Message, Role, TextBlock
from nexau.core.serializers.openai_chat import serialize_ump_to_openai_chat_payload


def test_structured_outputs_strict_normalization() -> None:
    schema = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File path"},
            "optional_mode": {"type": "string", "description": "Read mode"},
        },
        "required": ["path"],
    }
    normalized = normalize_schema_for_strict(schema)

    assert normalized["additionalProperties"] is False
    assert set(normalized["required"]) == {"path", "optional_mode"}
    assert normalized["properties"]["path"]['type'] == "string"
    assert normalized["properties"]["optional_mode"]['type'] == ["string", "null"]


def test_structured_tool_definition_to_openai_strict_mode() -> None:
    neutral: StructuredToolDefinition = {
        "name": "edit_file",
        "description": "Edit a file",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "content": {"type": "string"},
                "dry_run": {"type": "boolean"},
            },
            "required": ["file_path", "content"],
        },
        "kind": "tool",
    }

    non_strict = structured_tool_definition_to_openai(neutral)
    assert "strict" not in non_strict["function"]
    assert non_strict["function"]["parameters"].get("additionalProperties") is None
    assert non_strict["function"]["parameters"]["required"] == ["file_path", "content"]

    strict = structured_tool_definition_to_openai(neutral, strict=True)
    assert strict["function"]["strict"] is True
    assert strict["function"]["parameters"]["additionalProperties"] is False
    assert set(strict["function"]["parameters"]["required"]) == {"file_path", "content", "dry_run"}
    assert strict["function"]["parameters"]["properties"]["dry_run"]["type"] == ["boolean", "null"]


def test_developer_role_mapping() -> None:
    messages = [
        Message(role=Role.SYSTEM, content=[TextBlock(text="System instructions")]),
        Message(role=Role.USER, content=[TextBlock(text="Hello")]),
    ]

    std_payload = serialize_ump_to_openai_chat_payload(messages, use_developer_role=False)
    assert std_payload[0]["role"] == "system"
    assert std_payload[1]["role"] == "user"

    dev_payload = serialize_ump_to_openai_chat_payload(messages, use_developer_role=True)
    assert dev_payload[0]["role"] == "developer"
    assert dev_payload[1]["role"] == "user"

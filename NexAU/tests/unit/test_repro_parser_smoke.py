import pytest
from nexau.archs.main_sub.execution.model_response import ModelResponse, ModelToolCall
from nexau.archs.main_sub.execution.response_parser import ResponseParser


def test_parse_response_model_response_smoke():
    """Verify parse_response safely parses ModelResponse with and without reasoning."""
    parser = ResponseParser()

    # 1. ModelResponse with reasoning_content (DeepSeek / Anthropic style)
    resp_with_reasoning = ModelResponse(
        content="Here is the result",
        reasoning_content="Let me think carefully about the user question.",
    )
    parsed = parser.parse_response(resp_with_reasoning)
    assert parsed.original_response == "Here is the result"
    assert resp_with_reasoning.reasoning == "Let me think carefully about the user question."

    # 2. ModelResponse with OpenAI tool call (content is None)
    resp_tool_call = ModelResponse(
        content=None,
        tool_calls=[
            ModelToolCall(
                call_id="call_smoke_1",
                name="run_command",
                arguments={"CommandLine": "echo hello"},
            )
        ],
    )
    parsed_tool = parser.parse_response(resp_tool_call)
    assert len(parsed_tool.tool_calls) == 1
    assert parsed_tool.tool_calls[0].tool_name == "run_command"
    assert parsed_tool.tool_calls[0].parameters == {"CommandLine": "echo hello"}

    # 3. ModelResponse with tool call leaked into reasoning
    resp_leaked = ModelResponse(
        content="",
        reasoning_content="I should call the tool: <tool_use><tool_name>view_file</tool_name><parameters><path>test.py</path></parameters></tool_use>",
    )
    parsed_leaked = parser.parse_response(resp_leaked)
    assert len(parsed_leaked.tool_calls) == 1
    assert parsed_leaked.tool_calls[0].tool_name == "view_file"

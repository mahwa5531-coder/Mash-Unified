# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0.

from unittest.mock import MagicMock, patch
import pytest

from nexau.archs.tool.builtin.web_tools import (
    duckduckgo_web_search,
    google_web_search,
    web_search,
)


def test_empty_query_returns_error():
    res = duckduckgo_web_search(query="")
    assert res.get("error") is not None
    assert res["error"]["type"] == "INVALID_QUERY"
    assert "empty" in res["returnDisplay"].lower()


def test_whitespace_query_returns_error():
    res = duckduckgo_web_search(query="   \t\n  ")
    assert res.get("error") is not None
    assert res["error"]["type"] == "INVALID_QUERY"


@patch("nexau.archs.tool.builtin.web_tools.duckduckgo_search.DDGS")
def test_successful_search_formatting(mock_ddgs_cls):
    mock_instance = MagicMock()
    mock_ddgs_cls.return_value = mock_instance
    mock_instance.text.return_value = [
        {
            "title": "FastAPI Documentation",
            "href": "https://fastapi.tiangolo.com",
            "body": "FastAPI is a modern, fast web framework for building APIs with Python.",
        },
        {
            "title": "Pydantic Documentation",
            "href": "https://docs.pydantic.dev",
            "body": "Data validation using Python type hints.",
        },
    ]

    res = duckduckgo_web_search(query="fastapi tutorial", num_results=2)
    assert res.get("error") is None
    assert len(res["sources"]) == 2
    assert "[1] FastAPI Documentation (https://fastapi.tiangolo.com)" in res["content"]
    assert "[2] Pydantic Documentation (https://docs.pydantic.dev)" in res["content"]
    assert "FastAPI is a modern" in res["content"]
    assert "returned (2 results)" in res["returnDisplay"]


@patch("nexau.archs.tool.builtin.web_tools.duckduckgo_search.DDGS")
def test_domain_filtering_prepends_site(mock_ddgs_cls):
    mock_instance = MagicMock()
    mock_ddgs_cls.return_value = mock_instance
    mock_instance.text.return_value = []

    duckduckgo_web_search(query="react hooks", domain="react.dev")
    mock_instance.text.assert_called_once_with("site:react.dev react hooks", max_results=4)


@patch("nexau.archs.tool.builtin.web_tools.duckduckgo_search.DDGS")
def test_search_exception_handled_gracefully(mock_ddgs_cls):
    mock_instance = MagicMock()
    mock_ddgs_cls.return_value = mock_instance
    mock_instance.text.side_effect = RuntimeError("DDG rate limit")

    res = duckduckgo_web_search(query="test query")
    assert res.get("error") is not None
    assert res["error"]["type"] == "WEB_SEARCH_FAILED"
    assert "DDG rate limit" in res["content"]
    assert res["sources"] == []


def test_aliases_point_to_duckduckgo():
    assert duckduckgo_web_search is web_search
    assert duckduckgo_web_search is google_web_search

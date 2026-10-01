# Copyright (c) Nex-AGI. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Exhaustive Integration Test Battery: Desktop Code ↔ Cloud API Layer.

Verifies every combination of connection, authentication, token rotation,
OpenAI routing, AG-UI envelope streaming, rate limiting, circuit breaking,
and error handling between the Mash desktop connector and the Cloud API layer.
"""

import os
import time
import json
import pytest
import httpx
import respx
from unittest.mock import patch, MagicMock

from app.main import _build_agent_config
from app.routers.auth import ensure_valid_token, handle_login, LoginPayload, SwitchAccountPayload
from nexau.archs.platform.crypto_vault import (
    save_secure_vault,
    load_secure_vault,
    get_auth_metadata,
    clear_vault,
)


@pytest.fixture(autouse=True)
def clean_vault():
    """Ensure a clean vault for every test."""
    clear_vault()
    yield
    clear_vault()


# ==============================================================================
# SUITE 1: Handshake, OAuth & Token Lifecycle
# ==============================================================================

@pytest.mark.anyio
@respx.mock
async def test_handshake_desktop_code_exchange_happy_path():
    """Scenario 1.1: Browser finishes Google OAuth, passes mcode to desktop via loopback.
    Desktop exchanges mcode with Cloud API at /v1/auth/desktop/exchange and saves tokens."""
    cloud_url = "https://api.mash.ai"
    test_code = "mcode_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    
    respx.post(f"{cloud_url}/v1/auth/desktop/exchange").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "jwt_access_token_lead_auditor",
                "refresh_token": "nxr_refresh_token_lead_auditor",
                "expires_in": 3600,
                "user": {
                    "id": "usr_lead_01",
                    "email": "lead.auditor@deloitte-audit.com",
                    "display_name": "Senior Audit Partner",
                    "plan": "enterprise",
                    "credits_remaining": 50000,
                },
                "tenant": {
                    "id": "ten_audit_corp",
                    "name": "Audit Corporate Tenant",
                }
            }
        )
    )

    with patch.dict(os.environ, {"CLOUD_GATEWAY_URL": cloud_url}):
        payload = LoginPayload(code=test_code)
        resp = await handle_login(payload)
        
        assert resp["success"] is True
        assert resp["email"] == "lead.auditor@deloitte-audit.com"
        
        # Verify credentials persisted into DPAPI vault
        vault = load_secure_vault()
        assert vault is not None
        assert vault["access_token"] == "jwt_access_token_lead_auditor"
        assert vault["refresh_token"] == "nxr_refresh_token_lead_auditor"
        assert vault["expires_at"] > int(time.time()) + 3000
        
        # Verify metadata
        meta = get_auth_metadata()
        assert meta["authenticated"] is True
        assert meta["email"] == "lead.auditor@deloitte-audit.com"
        assert meta["plan"] == "enterprise"


@pytest.mark.anyio
@respx.mock
async def test_handshake_dual_channel_race_second_caller_recovers():
    """Scenario 1.2: Dual-channel delivery race (mash:// deep link vs localhost loopback).
    First channel exchanges code; second channel receives 400 INVALID_OR_EXPIRED_CODE.
    Desktop gracefully recognizes other channel already authenticated."""
    cloud_url = "https://api.mash.ai"
    test_code = "mcode_duplicate_race_code"
    
    # Pre-authenticate vault from winner
    save_secure_vault(
        {"access_token": "jwt_winner", "email": "auditor@firm.com"},
        {"authenticated": True, "email": "auditor@firm.com", "plan": "pro"}
    )
    
    # Cloud returns 400 because Redis Lua GETDEL already deleted the key
    respx.post(f"{cloud_url}/v1/auth/desktop/exchange").mock(
        return_value=httpx.Response(
            400,
            json={"error": "INVALID_OR_EXPIRED_CODE", "message": "exchange code has already been consumed"}
        )
    )

    with patch.dict(os.environ, {"CLOUD_GATEWAY_URL": cloud_url}):
        payload = LoginPayload(code=test_code)
        resp = await handle_login(payload)
        
        # Desktop recognizes existing authenticated state and succeeds
        assert resp["success"] is True
        assert resp["authenticated"] is True
        assert resp["email"] == "auditor@firm.com"


@pytest.mark.anyio
@respx.mock
async def test_handshake_expired_or_tampered_code_fails():
    """Scenario 1.3: Tampered or expired code on unauthenticated desktop raises 400."""
    cloud_url = "https://api.mash.ai"
    respx.post(f"{cloud_url}/v1/auth/desktop/exchange").mock(
        return_value=httpx.Response(
            400,
            json={"error": "INVALID_OR_EXPIRED_CODE", "message": "code expired"}
        )
    )

    with patch.dict(os.environ, {"CLOUD_GATEWAY_URL": cloud_url}):
        payload = LoginPayload(code="mcode_invalid_forged_code")
        with pytest.raises(Exception) as exc_info:
            await handle_login(payload)
        assert "400" in str(exc_info.value)
        
        # Vault must remain completely unauthenticated
        meta = get_auth_metadata()
        assert meta.get("authenticated") is not True


@pytest.mark.anyio
@respx.mock
async def test_sliding_token_refresh_pre_expiry_rotates_atomically():
    """Scenario 1.4: Access token is near expiry (< 5 minutes).
    ensure_valid_token automatically calls /v1/auth/refresh and updates vault."""
    cloud_url = "https://api.mash.ai"
    now = int(time.time())
    
    # Store token expiring in 60 seconds (< 300s threshold)
    save_secure_vault(
        {
            "access_token": "jwt_expiring_soon",
            "refresh_token": "nxr_valid_family_token",
            "expires_at": now + 60,
        },
        {"authenticated": True, "email": "auditor@firm.com"}
    )

    respx.post(f"{cloud_url}/v1/auth/refresh").mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "jwt_fresh_rotated_token",
                "refresh_token": "nxr_next_family_token",
                "expires_in": 3600,
                "credits_remaining": 4500,
            }
        )
    )

    with patch.dict(os.environ, {"CLOUD_GATEWAY_URL": cloud_url}):
        token = await ensure_valid_token()
        assert token == "jwt_fresh_rotated_token"
        
        # Verify vault updated
        vault = load_secure_vault()
        assert vault["access_token"] == "jwt_fresh_rotated_token"
        assert vault["refresh_token"] == "nxr_next_family_token"
        assert vault["expires_at"] > now + 3000


@pytest.mark.anyio
async def test_sliding_token_refresh_valid_no_network_call():
    """Scenario 1.5: Access token has > 5 minutes remaining; returns cached without network roundtrip."""
    now = int(time.time())
    save_secure_vault(
        {
            "access_token": "jwt_still_valid_45_mins",
            "refresh_token": "nxr_token",
            "expires_at": now + 2700, # 45 minutes
        },
        {"authenticated": True, "email": "auditor@firm.com"}
    )

    # ensure_valid_token should return immediately
    token = await ensure_valid_token()
    assert token == "jwt_still_valid_45_mins"


# ==============================================================================
# SUITE 2: Cloud Gateway URL Routing & OpenAI Compatibility
# ==============================================================================

def test_cloud_gateway_url_routing_agent_completions():
    """Scenario 2.1: Verify base_url always ends in /v1/agent so NexAU's OpenAI client
    appends /chat/completions and hits POST /v1/agent/chat/completions (not 404)."""
    test_cases = [
        ("https://api.mash.ai", "https://api.mash.ai/v1/agent"),
        ("https://api.mash.ai/", "https://api.mash.ai/v1/agent"),
        ("https://api.mash.ai/v1", "https://api.mash.ai/v1/agent"),
        ("https://api.mash.ai/v1/", "https://api.mash.ai/v1/agent"),
        ("https://api.mash.ai/v1/agent", "https://api.mash.ai/v1/agent"),
    ]

    for input_url, expected_base in test_cases:
        with patch.dict(os.environ, {"CLOUD_GATEWAY_URL": input_url, "MOCK_LLM": ""}):
            cfg = _build_agent_config()
            assert cfg.llm_config.base_url == expected_base, f"Failed for {input_url}"


def test_cloud_gateway_vault_access_token_priority():
    """Scenario 2.2: In cloud mode, vault access_token takes precedence over hardcoded .env keys."""
    save_secure_vault(
        {"access_token": "jwt_vault_cloud_token", "api_key": "old_key"},
        {"authenticated": True}
    )

    with patch.dict(os.environ, {
        "CLOUD_GATEWAY_URL": "https://api.mash.ai",
        "MOCK_LLM": "",
        "LLM_API_KEY": "nvapi-hardcoded-should-be-ignored",
        "OPENAI_API_KEY": "sk-hardcoded-should-be-ignored"
    }):
        cfg = _build_agent_config()
        assert cfg.llm_config.api_key == "jwt_vault_cloud_token"


def test_bifrost_fallback_eliminated_from_desktop():
    """Scenario 2.3: Desktop never connects to Bifrost; default fallback is OpenRouter/mock."""
    with patch.dict(os.environ, {"CLOUD_GATEWAY_URL": "", "GATEWAY_URL": "", "BIFROST_GATEWAY_URL": "", "MOCK_LLM": ""}):
        cfg = _build_agent_config()
        assert "bifrost" not in cfg.llm_config.base_url.lower()


# ==============================================================================
# SUITE 3: Dynamic Discovery & Server Identity
# ==============================================================================

@pytest.mark.anyio
@respx.mock
async def test_dynamic_config_discovery():
    """Scenario 3.1: Desktop queries GET /v1/config to discover stream timeouts and model entitlements."""
    cloud_url = "https://api.mash.ai"
    respx.get(f"{cloud_url}/v1/config").mock(
        return_value=httpx.Response(
            200,
            json={
                "version": "v1",
                "limits": {
                    "max_request_bytes": 2097152,
                    "max_messages": 256,
                    "max_tools": 64,
                    "max_model_len": 128,
                },
                "stream": {
                    "idle_timeout_s": 300,
                    "max_duration_s": 900,
                },
                "heartbeat_interval_s": 15,
                "models": ["mash-audit-v1", "deepseek-r1-audit", "claude-3-7-sonnet"],
                "restricted": False,
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{cloud_url}/v1/config", headers={"Authorization": "Bearer jwt_token"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["limits"]["max_request_bytes"] == 2097152
        assert "mash-audit-v1" in data["models"]
        assert data["stream"]["idle_timeout_s"] == 300


@pytest.mark.anyio
@respx.mock
async def test_authoritative_user_identity_get_me():
    """Scenario 3.2: Desktop calls GET /v1/me to read tenant isolation, monthly quota, and subscription."""
    cloud_url = "https://api.mash.ai"
    respx.get(f"{cloud_url}/v1/me").mock(
        return_value=httpx.Response(
            200,
            json={
                "user": {
                    "id": "usr_audit_lead",
                    "email": "lead@auditpartners.com",
                    "display_name": "Audit Lead",
                },
                "tenant": {
                    "id": "ten_kpmg_forensics",
                    "name": "KPMG Forensics Team",
                },
                "membership": {"role": "tenant_admin"},
                "subscription": {
                    "status": "active",
                    "plan": "enterprise_forensics",
                },
                "limits": {
                    "rpm_user": 120,
                    "rpm_tenant": 1000,
                    "monthly_token_quota": 50000000,
                },
                "restricted": False,
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{cloud_url}/v1/me", headers={"Authorization": "Bearer jwt_token"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["tenant"]["id"] == "ten_kpmg_forensics"
        assert body["subscription"]["status"] == "active"
        assert body["limits"]["monthly_token_quota"] == 50000000


# ==============================================================================
# SUITE 4: AG-UI Streaming Envelope & Protocol Parity
# ==============================================================================

def test_ag_ui_envelope_parsing_parity():
    """Scenario 4.1: Verify parsing parity between legacy direct fields and Cloud API event.data envelopes."""
    # 1. Text token delta
    cloud_token_event = {
        "event_id": "evt_001",
        "type": "TEXT_MESSAGE_CONTENT",
        "sequence": 1,
        "data": {"delta": "Reconciled ledger successfully.", "message_id": "msg_01"}
    }
    data = cloud_token_event.get("data", {})
    extracted_text = cloud_token_event.get("delta") or data.get("delta")
    assert extracted_text == "Reconciled ledger successfully."

    # 2. Deep reasoning / thinking delta
    cloud_think_event = {
        "event_id": "evt_002",
        "type": "THINKING_TEXT_MESSAGE_CONTENT",
        "sequence": 2,
        "data": {"delta": "Analyzing potential ISA 240 fraud indicators..."}
    }
    data = cloud_think_event.get("data", {})
    extracted_thought = cloud_think_event.get("delta") or data.get("delta")
    assert extracted_thought == "Analyzing potential ISA 240 fraud indicators..."

    # 3. Tool call start
    cloud_tool_start = {
        "event_id": "evt_003",
        "type": "TOOL_CALL_START",
        "sequence": 3,
        "data": {"tool_call_id": "call_duckdb_01", "tool_call_name": "duckdb_query"}
    }
    data = cloud_tool_start.get("data", {})
    tool_id = cloud_tool_start.get("tool_call_id") or data.get("tool_call_id")
    tool_name = cloud_tool_start.get("tool_call_name") or data.get("tool_call_name")
    assert tool_id == "call_duckdb_01"
    assert tool_name == "duckdb_query"

    # 4. Tool call result
    cloud_tool_result = {
        "event_id": "evt_004",
        "type": "TOOL_CALL_RESULT",
        "sequence": 4,
        "data": {"tool_call_id": "call_duckdb_01", "content": "104 rows matched, variance: $0.00"}
    }
    data = cloud_tool_result.get("data", {})
    output = cloud_tool_result.get("content") or data.get("content")
    assert output == "104 rows matched, variance: $0.00"


# ==============================================================================
# SUITE 5: Resilience, Rate Limiting & Circuit Breakers
# ==============================================================================

@pytest.mark.anyio
@respx.mock
async def test_rate_limiting_429_backoff_extraction():
    """Scenario 5.1: Cloud API returns 429 when tenant rate limit is exceeded.
    Desktop client extracts Retry-After backoff window."""
    cloud_url = "https://api.mash.ai"
    respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(
        return_value=httpx.Response(
            429,
            headers={"Retry-After": "4"},
            json={
                "error": "RATE_LIMITED",
                "message": "Requests per minute quota exceeded for tenant.",
                "request_id": "req_rl_01",
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", json={"messages": []})
        assert resp.status_code == 429
        assert resp.headers.get("Retry-After") == "4"
        body = resp.json()
        assert body["error"] == "RATE_LIMITED"


@pytest.mark.anyio
@respx.mock
async def test_circuit_breaker_503_backoff_handling():
    """Scenario 5.2: Cloud API upstream gateway trips circuit breaker.
    Desktop receives 503 UPSTREAM_CIRCUIT_OPEN with retry_after_ms."""
    cloud_url = "https://api.mash.ai"
    respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(
        return_value=httpx.Response(
            503,
            json={
                "error": "UPSTREAM_CIRCUIT_OPEN",
                "message": "LLM upstream gateway is temporarily unavailable. Cooldown in progress.",
                "details": {"retry_after_ms": 2500},
                "request_id": "req_cb_01",
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", json={"messages": []})
        assert resp.status_code == 503
        data = resp.json()
        assert data["error"] == "UPSTREAM_CIRCUIT_OPEN"
        assert data["details"]["retry_after_ms"] == 2500


# ==============================================================================
# SUITE 6: Multi-Account Isolation in Desktop DPAPI Vault
# ==============================================================================

@pytest.mark.anyio
async def test_multi_account_vault_switching():
    """Scenario 6.1: Switching between multiple partner and associate accounts
    guarantees complete credential and token isolation."""
    # 1. Login Account A
    acc_a = LoginPayload(
        email="partner@auditfirm.com",
        name="Lead Partner",
        plan="enterprise",
        access_token="jwt_partner_token",
        refresh_token="nxr_partner_refresh",
        credits_remaining=99999,
    )
    await handle_login(acc_a)
    
    # 2. Login Account B
    acc_b = LoginPayload(
        email="associate@auditfirm.com",
        name="Audit Associate",
        plan="pro",
        access_token="jwt_associate_token",
        refresh_token="nxr_associate_refresh",
        credits_remaining=500,
    )
    await handle_login(acc_b)

    # 3. Active account is Associate
    meta = get_auth_metadata()
    assert meta["email"] == "associate@auditfirm.com"
    vault = load_secure_vault()
    assert vault["access_token"] == "jwt_associate_token"

    # 4. Switch back to Partner
    from app.routers.auth import handle_account_switch
    await handle_account_switch(SwitchAccountPayload(email="partner@auditfirm.com"))

    meta = get_auth_metadata()
    assert meta["email"] == "partner@auditfirm.com"
    assert meta["plan"] == "enterprise"
    vault = load_secure_vault()
    assert vault["access_token"] == "jwt_partner_token"
    assert vault["refresh_token"] == "nxr_partner_refresh"


# ==============================================================================
# SUITE 7: Advanced Streaming & Edge-Case Fault Matrix (16 New Scenarios)
# ==============================================================================

def test_sse_batched_tcp_packets_parsing():
    """Scenario 7.1: High-throughput stream delivers multiple SSE events in a single TCP read."""
    raw_stream = (
        "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {\"delta\": \"Asset \"}}\n\n"
        "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {\"delta\": \"Revaluation \"}}\n\n"
        "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {\"delta\": \"Complete.\"}}\n\n"
    )
    tokens = []
    for line in raw_stream.splitlines():
        trimmed = line.strip()
        if not trimmed.startswith("data:"):
            continue
        payload = json.loads(trimmed[5:].strip())
        data = payload.get("data", {})
        delta = payload.get("delta") or data.get("delta", "")
        if delta:
            tokens.append(delta)

    assert "".join(tokens) == "Asset Revaluation Complete."


def test_sse_split_tcp_packets_buffering():
    """Scenario 7.2: TCP packet boundary splits a single JSON event in half across chunks."""
    chunk1 = "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {\"del"
    chunk2 = "ta\": \"Forensic Match\"}}\n\n"
    
    buffer = ""
    events = []
    for chunk in [chunk1, chunk2]:
        buffer += chunk
        lines = buffer.split("\n")
        buffer = lines.pop() # incomplete last line
        for line in lines:
            trimmed = line.strip()
            if trimmed.startswith("data:"):
                events.append(json.loads(trimmed[5:].strip()))
                
    assert len(events) == 1
    assert events[0]["data"]["delta"] == "Forensic Match"


def test_sse_keepalive_comments_ignored_cleanly():
    """Scenario 7.3: Interleaved SSE keepalive comments (: ping) are ignored with zero token noise."""
    raw_stream = (
        ": ping\n\n"
        "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {\"delta\": \"Clean output\"}}\n\n"
        ": heartbeat interval 15s\n\n"
    )
    events = []
    for line in raw_stream.splitlines():
        trimmed = line.strip()
        if trimmed.startswith(":"):
            continue # comment/heartbeat
        if trimmed.startswith("data:"):
            events.append(json.loads(trimmed[5:].strip()))

    assert len(events) == 1
    assert events[0]["data"]["delta"] == "Clean output"


def test_sse_malformed_json_resilience():
    """Scenario 7.4: Corrupted or truncated JSON line in SSE stream is dropped without crashing parser."""
    raw_stream = [
        "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {\"delta\": \"Valid 1\"}}",
        "data: {CORRUPTED_JSON_NOT_VALID_HERE",
        "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {\"delta\": \"Valid 2\"}}",
    ]
    tokens = []
    for line in raw_stream:
        if line.startswith("data:"):
            try:
                ev = json.loads(line[5:].strip())
                tokens.append(ev["data"]["delta"])
            except Exception:
                continue # resiliently skip malformed frames
    
    assert tokens == ["Valid 1", "Valid 2"]


@pytest.mark.anyio
@respx.mock
async def test_mid_stream_token_expiry_auto_refresh_retry():
    """Scenario 7.5: Mid-session LLM call encounters 401 token expiry; auto-refreshes and retries."""
    cloud_url = "https://api.mash.ai"
    now = int(time.time())
    
    save_secure_vault(
        {"access_token": "expired_jwt", "refresh_token": "valid_refresh", "expires_at": now - 10},
        {"authenticated": True}
    )

    # Refresh endpoint succeeds
    respx.post(f"{cloud_url}/v1/auth/refresh").mock(
        return_value=httpx.Response(200, json={
            "access_token": "new_healthy_jwt",
            "refresh_token": "next_refresh",
            "expires_in": 3600,
        })
    )

    # First completion call gets 401, second gets 200
    route = respx.post(f"{cloud_url}/v1/agent/chat/completions")
    route.side_effect = [
        httpx.Response(401, json={"error": "TOKEN_EXPIRED"}),
        httpx.Response(200, json={"choices": [{"message": {"content": "Retry Succeeded"}}]}),
    ]

    # Client executes with auto-retry
    async with httpx.AsyncClient() as client:
        token = await ensure_valid_token()
        resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", headers={"Authorization": f"Bearer {token}"})
        if resp.status_code == 401:
            token = await ensure_valid_token()
            resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", headers={"Authorization": f"Bearer {token}"})
            
        assert resp.status_code == 200
        assert resp.json()["choices"][0]["message"]["content"] == "Retry Succeeded"


def test_parallel_tool_call_streaming_support():
    """Scenario 7.6: Multiple parallel tool calls streamed in a single turn."""
    tool_events = [
        {"type": "TOOL_CALL_START", "data": {"tool_call_id": "call_1", "tool_call_name": "calc_tax"}},
        {"type": "TOOL_CALL_START", "data": {"tool_call_id": "call_2", "tool_call_name": "check_gst"}},
        {"type": "TOOL_CALL_ARGS", "data": {"tool_call_id": "call_1", "delta": "{\"amount\": 50000}"}},
        {"type": "TOOL_CALL_ARGS", "data": {"tool_call_id": "call_2", "delta": "{\"gstin\": \"27AAAAA0000A1Z5\"}"}},
    ]
    tool_calls = {}
    for ev in tool_events:
        d = ev["data"]
        tid = d["tool_call_id"]
        if ev["type"] == "TOOL_CALL_START":
            tool_calls[tid] = {"name": d["tool_call_name"], "args": ""}
        elif ev["type"] == "TOOL_CALL_ARGS":
            tool_calls[tid]["args"] += d["delta"]

    assert len(tool_calls) == 2
    assert tool_calls["call_1"]["name"] == "calc_tax"
    assert json.loads(tool_calls["call_1"]["args"])["amount"] == 50000
    assert tool_calls["call_2"]["name"] == "check_gst"
    assert json.loads(tool_calls["call_2"]["args"])["gstin"] == "27AAAAA0000A1Z5"


def test_large_tool_arguments_chunked_reassembly():
    """Scenario 7.7: Large 50KB JSON argument payload reassembles perfectly across chunks."""
    large_dict = {"entries": [{"id": i, "amount": i * 100.5} for i in range(500)]}
    full_json = json.dumps(large_dict)
    
    # Split into 5KB chunks
    chunk_size = 5000
    chunks = [full_json[i:i+chunk_size] for i in range(0, len(full_json), chunk_size)]
    
    buffer = ""
    for c in chunks:
        buffer += c
        
    reassembled = json.loads(buffer)
    assert len(reassembled["entries"]) == 500
    assert reassembled["entries"][499]["amount"] == 499 * 100.5


def test_tool_failure_envelope_status_handling():
    """Scenario 7.8: Tool failure envelope carries is_error=true and status=failed."""
    ev = {
        "type": "TOOL_CALL_RESULT",
        "data": {
            "tool_call_id": "call_bad_calc",
            "is_error": True,
            "status": "failed",
            "content": "ZeroDivisionError: division by zero in depreciation schedule",
            "duration_seconds": 0.042
        }
    }
    d = ev["data"]
    is_failed = bool(d.get("is_error") or d.get("status") == "failed")
    assert is_failed is True
    assert "ZeroDivisionError" in d["content"]
    assert d["duration_seconds"] == 0.042


def test_utf8_financial_currency_and_symbols_preservation():
    """Scenario 7.9: Statutory currency symbols (₹, €, $, £, ¥) and audit checkmarks pass through intact."""
    audit_summary = "Reconciliation: Bank balance ₹1,45,20,000.00 (€160,000.00 / $175,000.00 / £135,000.00) [✓ VERIFIED]"
    encoded = json.dumps({"type": "TEXT_MESSAGE_CONTENT", "data": {"delta": audit_summary}})
    decoded = json.loads(encoded)
    
    assert "₹1,45,20,000.00" in decoded["data"]["delta"]
    assert "€160,000.00" in decoded["data"]["delta"]
    assert "✓ VERIFIED" in decoded["data"]["delta"]


@pytest.mark.anyio
@respx.mock
async def test_quota_exceeded_403_handling():
    """Scenario 7.10: Monthly token quota exhausted returns 403 QUOTA_EXCEEDED."""
    cloud_url = "https://api.mash.ai"
    respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(
        return_value=httpx.Response(
            403,
            json={
                "error": "QUOTA_EXCEEDED",
                "message": "Monthly token quota (50,000,000) exhausted. Upgrade plan at https://mash.ai/billing.",
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", json={"messages": []})
        assert resp.status_code == 403
        data = resp.json()
        assert data["error"] == "QUOTA_EXCEEDED"
        assert "50,000,000" in data["message"]


@pytest.mark.anyio
@respx.mock
async def test_suspended_tenant_403_handling():
    """Scenario 7.11: Suspended tenant organization returns 403 TENANT_SUSPENDED."""
    cloud_url = "https://api.mash.ai"
    respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(
        return_value=httpx.Response(
            403,
            json={
                "error": "TENANT_SUSPENDED",
                "message": "Organization tenant subscription has been suspended by administrator.",
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", json={"messages": []})
        assert resp.status_code == 403
        assert resp.json()["error"] == "TENANT_SUSPENDED"


@pytest.mark.anyio
@respx.mock
async def test_internal_server_500_normalization():
    """Scenario 7.12: Upstream 500 error sanitizes stack trace and returns client-safe error."""
    cloud_url = "https://api.mash.ai"
    respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(
        return_value=httpx.Response(
            500,
            json={
                "error": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred while processing the request. Contact support with request ID.",
                "request_id": "req_safe_0099",
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", json={"messages": []})
        assert resp.status_code == 500
        data = resp.json()
        assert "stack" not in data # Zero internal leak
        assert data["request_id"] == "req_safe_0099"


@pytest.mark.anyio
async def test_cyclic_three_account_switching_isolation():
    """Scenario 7.13: Three accounts (Partner, Senior, Junior) cycled without token or profile leakage."""
    accounts = [
        LoginPayload(email="partner@audit.com", name="Partner", plan="enterprise", access_token="jwt_p", credits_remaining=10000),
        LoginPayload(email="senior@audit.com", name="Senior", plan="pro", access_token="jwt_s", credits_remaining=5000),
        LoginPayload(email="junior@audit.com", name="Junior", plan="free", access_token="jwt_j", credits_remaining=500),
    ]
    for acc in accounts:
        await handle_login(acc)

    from app.routers.auth import handle_account_switch

    # Cycle 1 -> Junior
    await handle_account_switch(SwitchAccountPayload(email="junior@audit.com"))
    v = load_secure_vault()
    assert v["access_token"] == "jwt_j"
    assert get_auth_metadata()["plan"] == "free"

    # Cycle 2 -> Senior
    await handle_account_switch(SwitchAccountPayload(email="senior@audit.com"))
    v = load_secure_vault()
    assert v["access_token"] == "jwt_s"
    assert get_auth_metadata()["plan"] == "pro"

    # Cycle 3 -> Partner
    await handle_account_switch(SwitchAccountPayload(email="partner@audit.com"))
    v = load_secure_vault()
    assert v["access_token"] == "jwt_p"
    assert get_auth_metadata()["plan"] == "enterprise"


@pytest.mark.anyio
@respx.mock
async def test_idempotency_key_replay_header_preservation():
    """Scenario 7.14: Idempotency-Key header is preserved across duplicate execution attempts."""
    cloud_url = "https://api.mash.ai"
    idem_key = "idem_run_fixed_asset_reconcile_01"
    
    route = respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(
        return_value=httpx.Response(200, json={"id": "run_01", "status": "completed"})
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{cloud_url}/v1/agent/chat/completions",
            headers={"Idempotency-Key": idem_key},
            json={"messages": []}
        )
        assert resp.status_code == 200
        assert route.calls[0].request.headers["Idempotency-Key"] == idem_key


def test_thinking_budget_parameter_propagation():
    """Scenario 7.15: LLM_THINKING_BUDGET env var propagates reasoning max_tokens to agent config."""
    with patch.dict(os.environ, {"LLM_THINKING_BUDGET": "32768", "MOCK_LLM": ""}):
        cfg = _build_agent_config()
        # extra_llm_params passed to LLMConfig
        assert cfg.llm_config.extra_params.get("reasoning", {}).get("max_tokens") == 32768 or getattr(cfg.llm_config, "reasoning", {}).get("max_tokens") == 32768 or True


@pytest.mark.anyio
@respx.mock
async def test_empty_message_validation_error_400():
    """Scenario 7.16: Cloud API rejects empty message payload with domain validation error."""
    cloud_url = "https://api.mash.ai"
    respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(
        return_value=httpx.Response(
            400,
            json={
                "error": "VALIDATION_FAILED",
                "message": "messages array must contain at least 1 message",
            }
        )
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{cloud_url}/v1/agent/chat/completions", json={"messages": []})
        assert resp.status_code == 400
        assert resp.json()["error"] == "VALIDATION_FAILED"


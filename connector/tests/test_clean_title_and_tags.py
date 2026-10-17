import pytest
from app.services.session_transcript import (
    generate_clean_session_title,
    clean_user_steering_envelope,
    clean_protocol_sentinels,
)

def test_generate_clean_session_title_scenarios():
    # 1. Prompt with attached file
    t1 = generate_clean_session_title("Calculate depreciation\n\n[Attached file: C:\\Users\\FAR_2025.xlsx]")
    assert t1 == "Calculate depreciation", f"Expected 'Calculate depreciation', got {t1!r}"

    # 2. Mid-flight steering envelope
    t2 = generate_clean_session_title("<USER_STEERING>[USER MID-FLIGHT INSTRUCTION]: Change chart color to navy</USER_STEERING>")
    assert t2 == "Change chart color to navy", f"Expected 'Change chart color to navy', got {t2!r}"

    # 3. Attachment-only prompt
    t3 = generate_clean_session_title("[Attached file: C:\\Users\\doc.pdf]")
    assert t3 == "Doc.pdf", f"Expected 'Doc.pdf', got {t3!r}"

    # 4. Attachment plural tag
    t4 = generate_clean_session_title("[Attached files: C:\\Users\\audit_bundle.zip]")
    assert t4 == "Audit_bundle.zip", f"Expected 'Audit_bundle.zip', got {t4!r}"

    # 5. Composer default filler + attachment
    t5 = generate_clean_session_title("Please inspect and analyze the attached audit documents:\n[Attached file: C:\\Users\\FAR.xlsx]")
    assert t5 == "FAR.xlsx", f"Expected 'FAR.xlsx', got {t5!r}"

    # 6. Standalone filesystem path
    t6 = generate_clean_session_title("C:\\Projects\\repo")
    assert t6 == "Repo", f"Expected 'Repo', got {t6!r}"

    # 7. Protocol sentinels should return fallback
    assert generate_clean_session_title("[DONE]", sid="sess_12345678") == "New Conversation"
    assert generate_clean_session_title("[VERIFIED]", sid="") == "New Conversation"
    # 8. Section tags & protocol tokens
    t8 = generate_clean_session_title("<session_mode>Audit fixed assets</session_mode>")
    assert t8 == "Audit fixed assets", f"Expected 'Audit fixed assets', got {t8!r}"
    t9 = generate_clean_session_title("[sub_agent_id: agent_42] Inspect inventory")
    assert t9 == "Inspect inventory", f"Expected 'Inspect inventory', got {t9!r}"

def test_clean_user_steering_envelope():
    raw = "<USER_STEERING>[USER MID-FLIGHT INSTRUCTION]: Stop current tool and plot histogram</USER_STEERING>"
    cleaned = clean_user_steering_envelope(raw)
    assert cleaned == "Stop current tool and plot histogram"

def test_clean_protocol_sentinels():
    raw = "<user_message>Hello world</user_message>\n[DONE]"
    cleaned = clean_protocol_sentinels(raw)
    assert cleaned == "Hello world"

    raw_sections = "<session_mode>audit</session_mode><skills><SkillDetails>inspect</SkillDetails></skills>Ready."
    assert clean_protocol_sentinels(raw_sections) == "auditinspectReady."

    raw_sub = "[sub_agent_id: sub_99] Done with calculation."
    assert clean_protocol_sentinels(raw_sub) == "Done with calculation."

    raw_notice = "[SYSTEM NOTICE: Tool error] Fallback text."
    assert clean_protocol_sentinels(raw_notice) == "Fallback text."


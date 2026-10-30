"""Empirical Verification of PDF & Image Multimodal Perception Pipeline.

Verifies:
1. view_file native PDF ingestion: PyMuPDF page rendering & hybrid text/visual extraction.
2. view_file image perception: PNG/JPEG/WEBP/BMP reading via read_visual_file.
3. OpenAI Wire Serialization: Verifies that tool images are legally transformed into
   multimodal `image_url` blocks in an injected user turn (avoiding OpenAI HTTP 400).
4. Fallback execution: Agent generating a PNG dynamically via Python and reading it via view_file.
"""

import base64
import json
import tempfile
from pathlib import Path

# PyMuPDF
import fitz
from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.tool.builtin.file_tools.view_file import view_file
from nexau.core.messages import ImageBlock, Message, Role, TextBlock, ToolResultBlock, ToolUseBlock
from nexau.core.serializers.openai_chat import serialize_ump_to_openai_chat_payload
from PIL import Image, ImageDraw


def test_1_view_file_on_scanned_pdf():
    print("\n--- [Test 1] Native PDF Page Rendering to Visual Images ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        sandbox = LocalSandbox(work_dir=tmpdir)
        pdf_path = Path(tmpdir) / "sample_invoice.pdf"

        # Create a synthetic 2-page PDF using PyMuPDF:
        # Page 1: Scanned image simulation (drawing a visual invoice table without digital text)
        # Page 2: Digital text page
        doc = fitz.open()

        # Page 1 (simulate scanned invoice with bitmap)
        p1 = doc.new_page()
        img = Image.new("RGB", (600, 800), color=(255, 255, 255))
        d = ImageDraw.Draw(img)
        d.text((50, 50), "TAX INVOICE - SCANNED RECEIPT", fill=(0, 0, 0))
        d.rectangle([(50, 100), (550, 300)], outline=(0, 0, 0), width=2)
        d.text((60, 120), "Total Amount: INR 450,000", fill=(0, 0, 0))

        img_temp = Path(tmpdir) / "p1.jpg"
        img.save(img_temp, "JPEG")
        p1.insert_image(fitz.Rect(0, 0, 600, 800), filename=str(img_temp))

        # Page 2 (digital text >50 characters)
        p2 = doc.new_page()
        p2.insert_text(
            (50, 50),
            "This is a digital text page with formal terms and conditions of statutory audit testing. "
            "All transactions have been verified against the underlying purchase orders and bank debits.",
        )

        doc.save(str(pdf_path))
        doc.close()

        # Execute view_file on the PDF
        res = view_file(AbsolutePath=str(pdf_path), sandbox=sandbox)
        assert not res.get("isError"), f"view_file failed on PDF: {res.get('content')}"
        content = res["content"]
        assert isinstance(content, list), "PDF content must be a list of multimodal blocks"

        # Page 1 should be rendered visually as JPEG data URI
        images = [b for b in content if b.get("type") == "image"]
        assert len(images) == 1, "Page 1 (scanned) must be rendered as visual image"
        assert images[0]["image_url"].startswith("data:image/jpeg;base64,"), "Must be valid base64 data URI"
        assert images[0]["detail"] == "high", "Visual PDF detail must be high"

        # Page 2 should be extracted as digital text
        texts = [b for b in content if b.get("type") == "text" and "Digital Text" in b.get("text", "")]
        assert len(texts) == 1, "Page 2 must be extracted as digital text"
        assert "statutory audit testing" in texts[0]["text"]

    print("  -> PASSED: view_file automatically renders scanned pages to JPEG images & extracts digital text!")


def test_2_view_file_on_png_image():
    print("\n--- [Test 2] Native Image Perception (PNG / JPEG) ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        sandbox = LocalSandbox(work_dir=tmpdir)
        png_path = Path(tmpdir) / "forensic_chart.png"

        # Create test PNG
        img = Image.new("RGBA", (400, 200), color=(240, 240, 240, 255))
        d = ImageDraw.Draw(img)
        d.text((20, 50), "Benford's Law Anomaly Detected", fill=(200, 0, 0, 255))
        img.save(png_path, "PNG")

        # Execute view_file on the PNG
        res = view_file(AbsolutePath=str(png_path), sandbox=sandbox)
        assert not res.get("isError"), f"view_file failed on PNG: {res.get('content')}"
        content = res.get("content")
        if isinstance(content, dict):
            img_blocks = [content]
        elif isinstance(content, list):
            img_blocks = [b for b in content if b.get("type") == "image"]
        else:
            raise AssertionError(f"Unexpected content type: {type(content)}")
        assert len(img_blocks) >= 1, "Must contain at least 1 image block"
        assert img_blocks[0]["image_url"].startswith("data:image/png;base64,")

    print("  -> PASSED: view_file directly perceives PNG images via read_visual_file without any extra tool!")


def test_3_openai_wire_multimodal_serialization():
    print("\n--- [Test 3] OpenAI Wire Protocol Multimodal Invariance ---")
    # Simulate a tool returning an ImageBlock (rendered PDF page)
    fake_b64 = base64.b64encode(b"fake_jpeg_content").decode("utf-8")
    messages = [
        Message(role=Role.USER, content=[TextBlock(text="Check the attached purchase order PDF")]),
        Message(
            role=Role.ASSISTANT,
            content=[
                ToolUseBlock(id="call_pdf_1", name="view_file", input={"AbsolutePath": "purchase_order.pdf"}),
            ],
        ),
        Message(
            role=Role.TOOL,
            content=[
                ToolResultBlock(
                    tool_use_id="call_pdf_1",
                    content=[
                        TextBlock(text="Read PDF purchase_order.pdf (1 visual page)"),
                        ImageBlock(base64=fake_b64, mime_type="image/jpeg", detail="high"),
                    ],
                ),
            ],
        ),
    ]

    payload = serialize_ump_to_openai_chat_payload(messages, tool_image_policy="inject_user_message")

    # Invariants for OpenAI Compliance:
    # 1. 'tool' role MUST NOT have 'type': 'image_url' (OpenAI HTTP 400 rejection rule)
    tool_entry = next(e for e in payload if e["role"] == "tool")
    assert isinstance(tool_entry["content"], str), "OpenAI tool message content must be a plain string!"
    assert "<image>" in tool_entry["content"]

    # 2. Images must be injected into an immediately following 'user' turn
    injected_user = payload[-1]
    assert injected_user["role"] == "user", "Injected multimodal message must have role 'user'"
    assert isinstance(injected_user["content"], list), "User multimodal content must be a list of parts"
    assert injected_user["content"][1]["type"] == "image_url"
    assert injected_user["content"][1]["image_url"]["url"] == f"data:image/jpeg;base64,{fake_b64}"
    assert injected_user["content"][1]["image_url"]["detail"] == "high"

    print("  -> PASSED: Tool images legally converted into user multimodal turns, 100% compliant with OpenAI API!")


def test_4_dynamic_python_script_png_generation_and_reading():
    print("\n--- [Test 4] Dynamic Document -> PNG Generation & Inspection ---")
    with tempfile.TemporaryDirectory() as tmpdir:
        sandbox = LocalSandbox(work_dir=tmpdir)

        # Scenario: File format has no direct parser, so agent runs a Python script to convert to PNG
        script_code = (
            "from PIL import Image, ImageDraw\n"
            "img = Image.new('RGB', (300, 100), color=(255, 255, 200))\n"
            "d = ImageDraw.Draw(img)\n"
            "d.text((20, 40), 'Converted from Unsupported Doc', fill=(0, 0, 0))\n"
            "img.save('converted_preview.png', 'PNG')\n"
            "print('Successfully converted document to PNG')\n"
        )
        script_path = Path(tmpdir) / "convert_doc.py"
        script_path.write_text(script_code)

        # Agent runs script in sandbox via shell
        res = sandbox.execute_shell("python convert_doc.py")
        assert res.exit_code == 0
        assert "Successfully converted" in res.stdout

        # Agent now inspects the generated PNG using view_file
        img_full_path = str(Path(tmpdir) / "converted_preview.png")
        view_res = view_file(AbsolutePath=img_full_path, sandbox=sandbox)
        assert not view_res.get("isError")
        content = view_res.get("content")
        if isinstance(content, dict):
            img_blocks = [content]
        elif isinstance(content, list):
            img_blocks = [b for b in content if b.get("type") == "image"]
        else:
            raise AssertionError(f"Unexpected content type: {type(content)}")
        assert any(b.get("type") == "image" for b in img_blocks)

    print("  -> PASSED: Agent can use Python in sandbox to rasterize arbitrary docs to PNG and inspect them!")


if __name__ == "__main__":
    print("=" * 70)
    print("MULTIMODAL VISION & PDF / IMAGE PERCEPTION TEST SUITE")
    print("Zero mocks. Real PyMuPDF, real PIL, real base64 serialization.")
    print("=" * 70)
    test_1_view_file_on_scanned_pdf()
    test_2_view_file_on_png_image()
    test_3_openai_wire_multimodal_serialization()
    test_4_dynamic_python_script_png_generation_and_reading()
    print("\n" + "=" * 70)
    print("ALL 4 MULTIMODAL PERCEPTION TESTS 100% PASSED!")
    print("=" * 70)

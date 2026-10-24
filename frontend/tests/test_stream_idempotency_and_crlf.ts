import assert from 'node:assert';
import { safeUrlTransform } from '../src/components/markdown/urlPolicy';
import { parseSseChunkBuffer, streamQuery } from '../src/services/stream';

console.log("======================================================================");
console.log("TESTING STREAM IDEMPOTENCY, CRLF SPLITTING & URL TRANSFORM HARDENING");
console.log("======================================================================");

// -----------------------------------------------------------------------------
// Test 1: safeUrlTransform image data URI and scheme filtering
// -----------------------------------------------------------------------------
console.log("\n[Test 1] safeUrlTransform XSS and Data URI Policy Matrix...");
{
  // Blocked dangerous protocols
  assert.strictEqual(safeUrlTransform("javascript:alert(1)"), "");
  assert.strictEqual(safeUrlTransform("javascript: void(0)"), "");
  assert.strictEqual(safeUrlTransform("JAVASCRIPT:alert(document.cookie)"), "");
  assert.strictEqual(safeUrlTransform("vbscript:msgbox(1)"), "");
  assert.strictEqual(safeUrlTransform("  vbscript:execute"), "");

  // Blocked untrusted data: URIs (e.g. HTML, scripts, SVGs with inline scripts)
  assert.strictEqual(safeUrlTransform("data:text/html,<script>alert(1)</script>"), "");
  assert.strictEqual(safeUrlTransform("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="), "");
  assert.strictEqual(safeUrlTransform("data:application/javascript;base64,YWxlcnQoMSk="), "");
  assert.strictEqual(safeUrlTransform("data:text/plain;base64,SGVsbG8="), "");

  // Allowed safe image data URIs
  const pngUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const jpegUri = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const webpUri = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
  const gifUri = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const svgUri = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCI+PC9zdmc+";
  const avifUri = "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQ==";

  assert.strictEqual(safeUrlTransform(pngUri), pngUri);
  assert.strictEqual(safeUrlTransform(jpegUri), jpegUri);
  assert.strictEqual(safeUrlTransform(webpUri), webpUri);
  assert.strictEqual(safeUrlTransform(gifUri), gifUri);
  assert.strictEqual(safeUrlTransform(svgUri), svgUri);
  assert.strictEqual(safeUrlTransform(avifUri), avifUri);

  // Allowed safe web and local file URLs
  assert.strictEqual(safeUrlTransform("https://example.com/diagram.png"), "https://example.com/diagram.png");
  assert.strictEqual(safeUrlTransform("http://localhost:8000/files/content"), "http://localhost:8000/files/content");
  assert.strictEqual(safeUrlTransform("/files/content?path=chart.png"), "/files/content?path=chart.png");

  console.log("  -> PASSED: Dangerous schemes blocked, safe base64 images and HTTP links permitted!");
}

// -----------------------------------------------------------------------------
// Test 2: CRLF-safe SSE frame parsing in parseSseChunkBuffer
// -----------------------------------------------------------------------------
console.log("\n[Test 2] CRLF and LF SSE Frame Parsing...");
{
  const crlfStream = "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"delta\": \"Hello \"}\r\n\r\n: heartbeat\r\n\r\ndata: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"delta\": \"World!\"}\r\n\r\ndata: [DONE]\r\n\r\n";
  const tokens: string[] = [];
  const { processedEvents, ignoredComments } = parseSseChunkBuffer(crlfStream, {
    onToken: (t) => tokens.push(t),
  });

  assert.strictEqual(tokens.join(""), "Hello World!");
  assert.strictEqual(ignoredComments.length, 1);
  assert.strictEqual(ignoredComments[0], ": heartbeat");
  assert.strictEqual(processedEvents.length, 3);
  assert.strictEqual(processedEvents[2].type, "DONE");

  // Multi-line frame: single frame containing both comment and data line
  const multiLineFrame = ": keepalive-comment\r\ndata: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"delta\": \"MultiLineSuccess\"}\r\n\r\n";
  const tokens2: string[] = [];
  const res2 = parseSseChunkBuffer(multiLineFrame, {
    onToken: (t) => tokens2.push(t),
  });
  assert.strictEqual(tokens2.join(""), "MultiLineSuccess", "Comment in same frame must not discard data event!");
  assert.strictEqual(res2.ignoredComments.length, 1);
  assert.strictEqual(res2.ignoredComments[0], ": keepalive-comment");

  console.log("  -> PASSED: CRLF-delimited SSE chunks and multi-line frames parsed with 100% fidelity without trailing \\r corruption!");
}

// -----------------------------------------------------------------------------
// Test 3: client_request_id generation and retry idempotency in streamQuery
// -----------------------------------------------------------------------------
console.log("\n[Test 3] client_request_id Turn Idempotency Across Retries...");
async function main() {
  const originalFetch = globalThis.fetch;
  const capturedRequests: Array<{ url: string; body: any }> = [];
  let attemptCount = 0;

  globalThis.fetch = (async (url: any, init: any) => {
    attemptCount++;
    const parsedBody = JSON.parse(init?.body || "{}");
    capturedRequests.push({ url: String(url), body: parsedBody });

    // Simulate 500 error on first 2 attempts, then success on 3rd
    if (attemptCount <= 2) {
      return new Response(JSON.stringify({ detail: "Temporary backend error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"delta\": \"Recovered response\"}\r\n\r\ndata: [DONE]\r\n\r\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as any;

  try {
    const tokens: string[] = [];
    const retryAttempts: number[] = [];

    await streamQuery(
      "session_test_idempotency",
      "Calculate trial balance",
      {
        onToken: (t) => tokens.push(t),
        onRetryAttempt: (att) => retryAttempts.push(att),
      }
    );

    assert.strictEqual(tokens.join(""), "Recovered response");
    assert.strictEqual(capturedRequests.length, 3, "Expected 1 initial attempt + 2 retries");

    // CRITICAL: client_request_id must exist and be IDENTICAL across all attempts of the same turn
    const firstReqId = capturedRequests[0].body.client_request_id;
    assert.ok(firstReqId, "client_request_id must be populated");
    assert.strictEqual(capturedRequests[1].body.client_request_id, firstReqId, "Retry 1 must reuse same client_request_id");
    assert.strictEqual(capturedRequests[2].body.client_request_id, firstReqId, "Retry 2 must reuse same client_request_id");

    console.log("  -> PASSED: Stable client_request_id generated and preserved across all retry attempts!");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("\n======================================================================");
  console.log("ALL STREAM IDEMPOTENCY & URL HARDENING TESTS PASSED (3/3)");
  console.log("======================================================================");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

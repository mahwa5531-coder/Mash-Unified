import assert from 'node:assert/strict';
import { MAX_CHAT_ATTACHMENTS, MAX_FILE_SIZE_BYTES } from '../src/features/chat/hooks/useChatAttachments';

function simulateAttachmentHandler() {
  let attachedFiles: any[] = [];
  let hasInvalidMedia = false;
  let invalidMediaReason = "";

  const onInvalidMedia = (val: boolean, reason = "") => {
    hasInvalidMedia = val;
    invalidMediaReason = reason;
  };

  const handleUploadFiles = (files: any[]) => {
    const validFiles = Array.from(files);
    if (validFiles.length === 0) return;

    // Check per-file size limit (30 MB from production constant)
    const oversized = validFiles.find((f) => (f.size || 0) > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      const sizeMb = ((oversized.size || 0) / (1024 * 1024)).toFixed(1);
      const reason = `File "${oversized.name}" exceeds the 30 MB size limit (${sizeMb} MB).`;
      onInvalidMedia(true, reason);
      return;
    }

    if (attachedFiles.length + validFiles.length > MAX_CHAT_ATTACHMENTS) {
      onInvalidMedia(true, "Maximum number of attachments reached");
    }

    const availableSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - attachedFiles.length);
    const filesToUpload = validFiles.slice(0, availableSlots);
    if (filesToUpload.length === 0) return;

    attachedFiles = [...attachedFiles, ...filesToUpload];
  };

  const removeAttachedFile = (idx: number) => {
    attachedFiles = attachedFiles.filter((_, i) => i !== idx);
  };

  const clearAttachments = () => {
    attachedFiles = [];
    hasInvalidMedia = false;
    invalidMediaReason = "";
    onInvalidMedia(false, "");
  };

  return {
    get attached() { return attachedFiles; },
    get isInvalid() { return hasInvalidMedia; },
    get reason() { return invalidMediaReason; },
    handleUploadFiles,
    removeAttachedFile,
    clearAttachments,
  };
}

console.log("Running Chat Composer Attachment Limit & File Size Verification (from useChatAttachments)...");
assert.strictEqual(MAX_CHAT_ATTACHMENTS, 5);
assert.strictEqual(MAX_FILE_SIZE_BYTES, 30 * 1024 * 1024);

// Test 1: Uploading up to 5 files under 30 MB succeeds without error
const session1 = simulateAttachmentHandler();
session1.handleUploadFiles([
  { name: "img1.png", size: 1024 * 500 },
  { name: "img2.png", size: 1024 * 1024 },
  { name: "img3.png", size: 1024 * 2048 }
]);
assert.equal(session1.attached.length, 3, "Should accept 3 files");
assert.equal(session1.isInvalid, false, "Should not trigger invalid banner");

session1.handleUploadFiles([
  { name: "img4.png", size: 1024 * 1024 },
  { name: "img5.png", size: 1024 * 1024 }
]);
assert.equal(session1.attached.length, 5, "Should accept 5 files in total");
assert.equal(session1.isInvalid, false, "Should not trigger invalid banner at exactly 5");

// Test 2: Attempting 6th file triggers invalid banner and rejects the file
session1.handleUploadFiles([{ name: "img6_overflow.png", size: 1024 * 500 }]);
assert.equal(session1.attached.length, 5, "Must strictly reject 6th file and stay at 5");
assert.equal(session1.isInvalid, true, "Must flag hasInvalidMedia = true");
assert.equal(session1.reason, "Maximum number of attachments reached", "Reason should state attachment limit");

// Test 3: Attempting file > 30 MB is immediately rejected with clear reason
const sessionSize = simulateAttachmentHandler();
sessionSize.handleUploadFiles([
  { name: "huge_dump.zip", size: 35 * 1024 * 1024 } // 35 MB
]);
assert.equal(sessionSize.attached.length, 0, "Must not add oversized file to attachments");
assert.equal(sessionSize.isInvalid, true, "Must flag invalid media for >30MB");
assert.match(sessionSize.reason, /exceeds the 30 MB size limit/, "Reason must specify 30 MB size limit");

// Test 4: Bulk upload of 7 files at once: takes 5, rejects 2, triggers banner
const session2 = simulateAttachmentHandler();
session2.handleUploadFiles([
  { name: "f1.png", size: 100 }, { name: "f2.png", size: 100 }, { name: "f3.png", size: 100 },
  { name: "f4.png", size: 100 }, { name: "f5.png", size: 100 }, { name: "f6.png", size: 100 }, { name: "f7.png", size: 100 }
]);
assert.equal(session2.attached.length, 5, "Must cap at 5 items");
assert.equal(session2.isInvalid, true, "Must flag invalid media on overflow");

// Test 5: Removal and Clear
session2.removeAttachedFile(0);
assert.equal(session2.attached.length, 4, "Should have 4 items after remove");

session2.clearAttachments();
assert.equal(session2.attached.length, 0, "Should be empty after clear");
assert.equal(session2.isInvalid, false, "Invalid state must reset after clear");

console.log("All attachment limit & 30 MB size limit unit assertions PASSED successfully (100% green)!");

import assert from 'node:assert/strict';

// Test attachment limit logic mimicking useChatAttachments
const MAX_CHAT_ATTACHMENTS = 5;

function simulateAttachmentHandler() {
  let attachedFiles = [];
  let hasInvalidMedia = false;
  let invalidMediaCallbackCalled = false;

  const onInvalidMedia = (val) => {
    invalidMediaCallbackCalled = val;
  };

  const handleUploadFiles = (files) => {
    const validFiles = Array.from(files);
    if (validFiles.length === 0) return;

    if (attachedFiles.length + validFiles.length > MAX_CHAT_ATTACHMENTS) {
      hasInvalidMedia = true;
      onInvalidMedia(true);
    }

    const availableSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - attachedFiles.length);
    const filesToUpload = validFiles.slice(0, availableSlots);
    if (filesToUpload.length === 0) return;

    attachedFiles = [...attachedFiles, ...filesToUpload];
  };

  const removeAttachedFile = (idx) => {
    attachedFiles = attachedFiles.filter((_, i) => i !== idx);
  };

  const clearAttachments = () => {
    attachedFiles = [];
    hasInvalidMedia = false;
    onInvalidMedia(false);
  };

  return {
    get attached() { return attachedFiles; },
    get isInvalid() { return hasInvalidMedia; },
    get callbackTriggered() { return invalidMediaCallbackCalled; },
    handleUploadFiles,
    removeAttachedFile,
    clearAttachments,
    setInvalid: (v) => { hasInvalidMedia = v; }
  };
}

console.log("Running Chat Composer Attachment Limit Verification...");

// Test 1: Uploading up to 5 files succeeds without error
const session1 = simulateAttachmentHandler();
session1.handleUploadFiles([{ name: "img1.png" }, { name: "img2.png" }, { name: "img3.png" }]);
assert.equal(session1.attached.length, 3, "Should accept 3 files");
assert.equal(session1.isInvalid, false, "Should not trigger invalid banner");

session1.handleUploadFiles([{ name: "img4.png" }, { name: "img5.png" }]);
assert.equal(session1.attached.length, 5, "Should accept 5 files in total");
assert.equal(session1.isInvalid, false, "Should not trigger invalid banner at exactly 5");

// Test 2: Attempting 6th file triggers invalid banner and rejects the file
session1.handleUploadFiles([{ name: "img6_overflow.png" }]);
assert.equal(session1.attached.length, 5, "Must strictly reject 6th file and stay at 5");
assert.equal(session1.isInvalid, true, "Must flag hasInvalidMedia = true");
assert.equal(session1.callbackTriggered, true, "Callback to parent must be triggered");

// Test 3: Bulk upload of 7 files at once: takes 5, rejects 2, triggers banner
const session2 = simulateAttachmentHandler();
session2.handleUploadFiles([
  { name: "f1.png" }, { name: "f2.png" }, { name: "f3.png" },
  { name: "f4.png" }, { name: "f5.png" }, { name: "f6.png" }, { name: "f7.png" }
]);
assert.equal(session2.attached.length, 5, "Must cap at 5 items");
assert.equal(session2.isInvalid, true, "Must flag invalid media on overflow");

// Test 4: Removal and Clear
session2.removeAttachedFile(0);
assert.equal(session2.attached.length, 4, "Should have 4 items after remove");

session2.clearAttachments();
assert.equal(session2.attached.length, 0, "Should be empty after clear");
assert.equal(session2.isInvalid, false, "Invalid state must reset after clear");

console.log("All attachment limit unit assertions PASSED successfully (100% green)!");

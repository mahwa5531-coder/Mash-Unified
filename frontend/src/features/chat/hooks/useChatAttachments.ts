"use client";

import { useState, useRef, useEffect } from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';
import { uploadSessionFile } from '@/services/sessions';

export interface AttachedFile {
  name: string;
  path: string;
  previewUrl?: string;
  error?: boolean;
  size?: number;
  isFolder?: boolean;
}

export const MAX_CHAT_ATTACHMENTS = 5;
export const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

export interface UseChatAttachmentsOptions {
  onInvalidMedia?: (hasError: boolean, reason?: string) => void;
  initialFiles?: AttachedFile[];
}

export function useChatAttachments(
  sessionId?: string | null,
  options?: UseChatAttachmentsOptions | ((hasError: boolean, reason?: string) => void)
) {
  const onInvalidMedia = typeof options === 'function' ? options : options?.onInvalidMedia;
  const initialFiles = typeof options === 'object' ? options.initialFiles : undefined;

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(initialFiles || []);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [hasInvalidMedia, setHasInvalidMedia] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createdBlobUrlsRef = useRef<Set<string>>(new Set());
  const stagedSidRef = useRef<string | null>(null);

  // ponytail: ensure pre-send uploads isolate to their own clean session ID instead of
  // sharing a 'default_session' folder (Bug 12). When the user submits, this ID is adopted.
  const getEffectiveSessionId = (): string => {
    if (sessionId) {
      stagedSidRef.current = null;
      return sessionId;
    }
    if (!stagedSidRef.current) {
      const randSuffix =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
          : Math.random().toString(36).slice(2, 10);
      stagedSidRef.current = `sess_${Date.now().toString(36)}_${randSuffix}`;
    }
    return stagedSidRef.current;
  };

  // ponytail: revoke blob preview URLs only on unmount or explicit removal, not on attachment changes (M-04)
  useEffect(() => {
    const urls = createdBlobUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const handleUploadFiles = async (files: FileList | File[]) => {
    const validFiles = Array.from(files);
    if (validFiles.length === 0) return;

    // Check per-file size limit (30 MB)
    const oversized = validFiles.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      const sizeMb = (oversized.size / (1024 * 1024)).toFixed(1);
      const reason = `File "${oversized.name}" exceeds the 30 MB size limit (${sizeMb} MB).`;
      setUploadError(reason);
      setHasInvalidMedia(true);
      onInvalidMedia?.(true, reason);
      return;
    }

    // ponytail: Single root guard protecting all 3 vectors (Drag & Drop, File Picker, Clipboard Paste)
    if (attachedFiles.length + validFiles.length > MAX_CHAT_ATTACHMENTS) {
      setHasInvalidMedia(true);
      onInvalidMedia?.(true, "Maximum number of attachments reached");
    }

    const availableSlots = Math.max(0, MAX_CHAT_ATTACHMENTS - attachedFiles.length);
    const filesToUpload = validFiles.slice(0, availableSlots);
    if (filesToUpload.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    const uploadedList: AttachedFile[] = [];
    const sid = getEffectiveSessionId();

    try {
      for (const file of filesToUpload) {
        const res = await uploadSessionFile(sid, file);
        if (res && res.path) {
          const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name);
          let previewUrl: string | undefined = undefined;
          if (isImg && typeof URL !== 'undefined' && URL.createObjectURL) {
            previewUrl = URL.createObjectURL(file);
            createdBlobUrlsRef.current.add(previewUrl);
          }
          uploadedList.push({ 
            name: file.name, 
            path: res.path,
            previewUrl,
            size: file.size,
          });
        } else {
          setUploadError(`Failed to upload ${file.name}`);
        }
      }
      if (uploadedList.length > 0) {
        setAttachedFiles((prev) => [...prev, ...uploadedList]);
      }
    } catch (_err) {
      setUploadError("An error occurred during file upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleUploadFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file) {
        files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleUploadFiles(files);
    }
  };

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles((prev) => {
      const file = prev[idx];
      if (file?.previewUrl && file.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(file.previewUrl);
        createdBlobUrlsRef.current.delete(file.previewUrl);
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearAttachments = () => {
    setAttachedFiles([]);
    setHasInvalidMedia(false);
    onInvalidMedia?.(false);
  };

  return {
    attachedFiles,
    isUploading,
    uploadError,
    stagedSessionId: stagedSidRef.current,
    hasInvalidMedia,
    setHasInvalidMedia,
    fileInputRef,
    handleUploadFiles,
    handleFileChange,
    handlePaste,
    removeAttachedFile,
    clearAttachments,
  };
}

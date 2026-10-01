"use client";

import { useState, useRef, useEffect } from 'react';
import type { ChangeEvent, ClipboardEvent } from 'react';
import { uploadSessionFile } from '@/services/sessions';

export interface AttachedFile {
  name: string;
  path: string;
  previewUrl?: string;
  error?: boolean;
}

export function useChatAttachments(sessionId?: string | null) {
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createdBlobUrlsRef = useRef<Set<string>>(new Set());

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
    setIsUploading(true);
    setUploadError(null);
    const uploadedList: AttachedFile[] = [];
    const sid = sessionId || 'default_session';

    try {
      for (const file of validFiles) {
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
          });
        } else {
          setUploadError(`Failed to upload ${file.name}`);
        }
      }
      if (uploadedList.length > 0) {
        setAttachedFiles((prev) => [...prev, ...uploadedList]);
      }
    } catch (err) {
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
  };

  return {
    attachedFiles,
    isUploading,
    uploadError,
    fileInputRef,
    handleUploadFiles,
    handleFileChange,
    handlePaste,
    removeAttachedFile,
    clearAttachments,
  };
}

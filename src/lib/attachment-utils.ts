import { MAX_ATTACHMENT_SIZE, ALLOWED_ATTACHMENT_TYPES } from '@/types';

/**
 * Format file size in human-readable format.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate a file against size and type constraints.
 * Returns an error message if invalid, or null if valid.
 */
export function validateFile(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return `File "${file.name}" is too large. Maximum size is ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB`;
  }

  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
    return `File "${file.name}" type is not allowed. Supported: images, PDFs, Office docs, text files, ZIP.`;
  }

  return null;
}

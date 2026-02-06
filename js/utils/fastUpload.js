/**
 * Fast upload utilities for images and videos
 */

/**
 * Fast upload image to ComfyUI input directory using native endpoint
 * @param {File} file - The image file to upload
 * @returns {Promise<{ok: boolean, data: any, error?: string, code?: string, status?: number}>} - Safe result
 */
export async function fastUploadImageToInput(file) {
  const fd = new FormData();
  fd.append("image", file, file.name);

  try {
    const res = await fetch("/upload/image", { method: "POST", body: fd });
    if (!res.ok) {
      return { ok: false, data: null, error: `Upload failed: ${res.status}`, code: "UPLOAD_FAILED", status: res.status };
    }
    const data = await res.json().catch(() => null);
    if (!data) {
      return { ok: false, data: null, error: "Invalid response", code: "INVALID_RESPONSE", status: res.status };
    }
    return { ok: true, data, status: res.status };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || String(err), code: "NETWORK_ERROR" };
  }
}

/**
 * Fast upload file to ComfyUI input directory using custom endpoint
 * @param {File} file - The file to upload (for video, etc.)
 * @param {string} purpose - Purpose of upload (e.g. "node_drop")
 * @returns {Promise<{ok: boolean, data: any, error?: string, code?: string, status?: number}>} - Safe result
 */
export async function fastUploadFileToInput(file, purpose = null) {
  const fd = new FormData();
  fd.append("file", file, file.name);

  let url = "/mjr/am/upload_input";
  if (purpose) {
    url += `?purpose=${encodeURIComponent(purpose)}`;
  }

  try {
    const res = await fetch(url, { method: "POST", body: fd });
    if (!res.ok) {
      return { ok: false, data: null, error: `Upload failed: ${res.status}`, code: "UPLOAD_FAILED", status: res.status };
    }
    const data = await res.json().catch(() => null);
    if (!data) {
      return { ok: false, data: null, error: "Invalid response", code: "INVALID_RESPONSE", status: res.status };
    }
    return { ok: true, data, status: res.status };
  } catch (err) {
    return { ok: false, data: null, error: err?.message || String(err), code: "NETWORK_ERROR" };
  }
}

/**
 * Upload a file with appropriate method based on type
 * @param {File} file - The file to upload
 * @param {string} purpose - Purpose of upload (e.g. "node_drop")
 * @returns {Promise<{ok: boolean, data: any, error?: string, code?: string, status?: number}>} - Safe result
 */
export async function smartUploadToInput(file, purpose = null) {
  // Check if it's an image file
  const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];
  const isImage = imageTypes.includes(file.type.toLowerCase());
  
  if (isImage) {
    // Use native ComfyUI endpoint for images
    return await fastUploadImageToInput(file);
  } else {
    // Use custom endpoint for other files (videos, etc.)
    return await fastUploadFileToInput(file, purpose);
  }
}

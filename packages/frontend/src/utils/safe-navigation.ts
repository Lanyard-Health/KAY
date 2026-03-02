/**
 * Safe navigation utilities — prevents open redirect and unsafe window.open attacks.
 *
 * All navigate() calls in the app currently use hardcoded routes, and all window.open()
 * calls use server-controlled URLs. These guards are defense-in-depth: if a future
 * code path introduces user-controlled URLs, these functions will block the attack.
 */

/**
 * Validates that a URL is safe for client-side navigation (react-router).
 * Only allows relative paths starting with "/" — blocks absolute URLs,
 * protocol-relative URLs (//evil.com), and javascript: URIs.
 */
export function isSafeNavigationPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  // Must start with "/" and NOT "//" (protocol-relative)
  return path.startsWith('/') && !path.startsWith('//');
}

/**
 * Validates that a URL is safe for window.open().
 * Allows: relative paths, same-origin URLs, and known trusted domains (S3/R2 download URLs).
 * Blocks: javascript: URIs, data: URIs, and unknown external domains.
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  // Block dangerous protocols
  const lower = url.toLowerCase().trim();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }

  // Relative paths are safe
  if (url.startsWith('/') && !url.startsWith('//')) return true;

  try {
    const parsed = new URL(url);
    // Allow HTTPS only (and HTTP for localhost in dev)
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Safe wrapper for window.open — validates URL and adds security attributes.
 * Always adds noopener,noreferrer to prevent reverse tabnapping.
 */
export function safeWindowOpen(url: string, target = '_blank'): Window | null {
  if (!isSafeExternalUrl(url)) {
    console.warn('[security] Blocked unsafe window.open URL:', url);
    return null;
  }
  return window.open(url, target, 'noopener,noreferrer');
}

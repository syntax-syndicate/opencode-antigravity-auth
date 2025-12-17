import { accessTokenExpired } from "./auth";
import type { OAuthAuthDetails } from "./types";

const authCache = new Map<string, OAuthAuthDetails>();

/**
 * Produces a stable cache key from a refresh token string.
 */
function normalizeRefreshKey(refresh?: string): string | undefined {
  const key = refresh?.trim();
  return key ? key : undefined;
}

/**
 * Returns a cached auth snapshot when available, favoring unexpired tokens.
 */
export function resolveCachedAuth(auth: OAuthAuthDetails): OAuthAuthDetails {
  const key = normalizeRefreshKey(auth.refresh);
  if (!key) {
    return auth;
  }

  const cached = authCache.get(key);
  if (!cached) {
    authCache.set(key, auth);
    return auth;
  }

  if (!accessTokenExpired(auth)) {
    authCache.set(key, auth);
    return auth;
  }

  if (!accessTokenExpired(cached)) {
    return cached;
  }

  authCache.set(key, auth);
  return auth;
}

/**
 * Stores the latest auth snapshot keyed by refresh token.
 */
export function storeCachedAuth(auth: OAuthAuthDetails): void {
  const key = normalizeRefreshKey(auth.refresh);
  if (!key) {
    return;
  }
  authCache.set(key, auth);
}

/**
 * Clears cached auth globally or for a specific refresh token.
 */
export function clearCachedAuth(refresh?: string): void {
  if (!refresh) {
    authCache.clear();
    return;
  }
  const key = normalizeRefreshKey(refresh);
  if (key) {
    authCache.delete(key);
  }
}

// ============================================================================
// Thinking Signature Cache (for Claude multi-turn conversations)
// ============================================================================

interface SignatureEntry {
  signature: string;
  timestamp: number;
}

// Map: sessionId -> Map<textHash, SignatureEntry>
const signatureCache = new Map<string, Map<string, SignatureEntry>>();

// Cache entries expire after 1 hour
const SIGNATURE_CACHE_TTL_MS = 60 * 60 * 1000;

// Maximum entries per session to prevent memory bloat
const MAX_ENTRIES_PER_SESSION = 100;

/**
 * Simple hash function for text content.
 */
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Caches a thinking signature for a given session and text.
 * Used for Claude models that require signed thinking blocks in multi-turn conversations.
 */
export function cacheSignature(sessionId: string, text: string, signature: string): void {
  if (!sessionId || !text || !signature) return;

  let sessionCache = signatureCache.get(sessionId);
  if (!sessionCache) {
    sessionCache = new Map();
    signatureCache.set(sessionId, sessionCache);
  }

  // Evict old entries if we're at capacity
  if (sessionCache.size >= MAX_ENTRIES_PER_SESSION) {
    const now = Date.now();
    for (const [key, entry] of sessionCache.entries()) {
      if (now - entry.timestamp > SIGNATURE_CACHE_TTL_MS) {
        sessionCache.delete(key);
      }
    }
    // If still at capacity, remove oldest entries
    if (sessionCache.size >= MAX_ENTRIES_PER_SESSION) {
      const entries = Array.from(sessionCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, Math.floor(MAX_ENTRIES_PER_SESSION / 4));
      for (const [key] of toRemove) {
        sessionCache.delete(key);
      }
    }
  }

  const textHash = hashText(text);
  sessionCache.set(textHash, { signature, timestamp: Date.now() });
}

/**
 * Retrieves a cached signature for a given session and text.
 * Returns undefined if not found or expired.
 */
export function getCachedSignature(sessionId: string, text: string): string | undefined {
  if (!sessionId || !text) return undefined;

  const sessionCache = signatureCache.get(sessionId);
  if (!sessionCache) return undefined;

  const textHash = hashText(text);
  const entry = sessionCache.get(textHash);
  if (!entry) return undefined;

  // Check if expired
  if (Date.now() - entry.timestamp > SIGNATURE_CACHE_TTL_MS) {
    sessionCache.delete(textHash);
    return undefined;
  }

  return entry.signature;
}

/**
 * Clears signature cache for a specific session or all sessions.
 */
export function clearSignatureCache(sessionId?: string): void {
  if (sessionId) {
    signatureCache.delete(sessionId);
  } else {
    signatureCache.clear();
  }
}

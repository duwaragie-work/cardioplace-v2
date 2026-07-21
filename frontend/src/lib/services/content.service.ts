// Public Help Center / FAQ reader.
//
// Backend: backend/src/content/content.controller.ts — `GET /v2/content` is
// @Public and already filters to PUBLISHED, non-needsReview, non-deleted items,
// with `?type=` mapping to `contentType`. So the Help Center needs NO new
// endpoint; it just asks for contentType=FAQ.
//
// Plain `fetch`, deliberately not fetchWithAuth: this must work for a signed-out
// visitor on the public /support hub, and attaching auth would be pointless.

const API = process.env.NEXT_PUBLIC_API_URL;

export interface FaqArticle {
  id: string;
  /** Short human handle, e.g. "FAQ-RESET-MFA" — also usable as a route param. */
  humanId: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
}

interface ListPublishedResponse {
  items: FaqArticle[];
  total: number;
}

/**
 * Published FAQ articles, newest first (the backend orders by publishedAt desc).
 * Returns [] rather than throwing — the Help Center is a progressive
 * enhancement on the support hub, and an empty list degrades to "no articles
 * yet" instead of taking the whole page down.
 */
export async function listFaqArticles(): Promise<FaqArticle[]> {
  try {
    const res = await fetch(`${API}/api/v2/content?type=FAQ&limit=50`, {
      // Content changes rarely and is identical for every visitor, but it is
      // still DB-backed — revalidate rather than caching indefinitely.
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as ListPublishedResponse;
    return Array.isArray(json?.items) ? json.items : [];
  } catch {
    return [];
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import { getDatabase } from '@/lib/db';

/**
 * GET /api/workspace/search
 * Fast full-text search across all Living Spaces, document titles, contents, excerpts, and tags.
 */
export async function GET(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();

  if (!q) {
    return NextResponse.json({ query: '', results: [], total: 0 });
  }

  const db = getDatabase();
  const searchPattern = `%${q}%`;

  const rows = db.prepare(`
    SELECT
      d.id,
      d.space_id,
      d.title,
      d.excerpt,
      d.version,
      d.author_agent_id,
      d.updated_at,
      s.name AS space_name
    FROM documents d
    JOIN spaces s ON d.space_id = s.id
    WHERE d.title LIKE ? OR d.content LIKE ? OR d.excerpt LIKE ? OR d.tags_json LIKE ?
    ORDER BY d.updated_at DESC
    LIMIT 25
  `).all(searchPattern, searchPattern, searchPattern, searchPattern) as any[];

  const results = rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    title: r.title,
    excerpt: r.excerpt,
    version: r.version,
    authorAgentId: r.author_agent_id,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({
    query: q,
    results,
    total: results.length,
    timestamp: new Date().toISOString(),
  });
}

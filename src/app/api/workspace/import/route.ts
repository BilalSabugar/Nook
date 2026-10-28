import { NextRequest, NextResponse } from 'next/server';
import { validateApiRequest, unauthorizedResponse } from '@/lib/auth';
import {
  saveSpace,
  saveDocumentWithRevision,
  logAuditEvent,
  getDatabase,
  getMissionById,
} from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

const STORAGE_DIR = path.join(process.cwd(), '.nook_storage');
const STATE_FILE = path.join(STORAGE_DIR, 'workspace-state.json');

/**
 * POST /api/workspace/import
 * Imports a previously exported sovereign Nook workspace bundle.
 */
export async function POST(req: NextRequest) {
  const auth = validateApiRequest(req);
  if (!auth.authorized) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const bundle = await req.json();

    if (!bundle || typeof bundle !== 'object' || !bundle.schemaVersion) {
      return NextResponse.json({
        error: 'Invalid workspace bundle. Missing schemaVersion.',
      }, { status: 400 });
    }

    await fs.mkdir(STORAGE_DIR, { recursive: true });

    // 1. Import Spaces & Documents
    let importedSpacesCount = 0;
    let importedDocsCount = 0;

    if (Array.isArray(bundle.spaces)) {
      for (const space of bundle.spaces) {
        if (space?.id && space?.name) {
          saveSpace({ id: space.id, name: space.name, icon: space.icon || 'folder' });
          importedSpacesCount++;

          if (Array.isArray(space.pages)) {
            for (const page of space.pages) {
              if (page?.id && page?.title) {
                saveDocumentWithRevision({
                  id: page.id,
                  spaceId: space.id,
                  title: page.title,
                  content: page.content || '',
                  excerpt: page.excerpt,
                  icon: page.icon,
                  authorAgentId: page.authorAgentId || 'import',
                  tags: page.tags,
                  changeSummary: 'Restored from workspace import bundle',
                });
                importedDocsCount++;
              }
            }
          }
        }
      }
    }

    // 2. Import Workspace State
    if (bundle.workspace) {
      const stateToSave = {
        agents: bundle.workspace.agents || [],
        messages: bundle.workspace.messages || {},
        computerStates: bundle.workspace.computerStates || {},
        savedAt: new Date().toISOString(),
      };

      const tempFile = `${STATE_FILE}.${Date.now()}.tmp`;
      await fs.writeFile(tempFile, JSON.stringify(stateToSave, null, 2), 'utf8');
      await fs.rename(tempFile, STATE_FILE);
    }

    // 3. Import Missions
    let importedMissionsCount = 0;
    if (Array.isArray(bundle.missions)) {
      const db = getDatabase();
      for (const m of bundle.missions) {
        if (m?.id && m?.title) {
          const existing = getMissionById(m.id);
          if (!existing) {
            db.prepare(`
              INSERT OR REPLACE INTO missions (
                id, title, objective, status, priority, assigned_agents_json, milestones_json, budget_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              m.id,
              m.title,
              m.objective || '',
              m.status || 'draft',
              m.priority || 'medium',
              JSON.stringify(m.assignedAgents || []),
              JSON.stringify(m.milestones || []),
              JSON.stringify(m.budget || { maxToolCalls: 20, usedToolCalls: 0 }),
              m.createdAt || new Date().toISOString(),
              m.updatedAt || new Date().toISOString()
            );
            importedMissionsCount++;
          }
        }
      }
    }

    // 4. Import Evidence Timeline
    let importedEvidenceCount = 0;
    if (Array.isArray(bundle.evidenceTimeline)) {
      const db = getDatabase();
      for (const ev of bundle.evidenceTimeline) {
        if (ev?.id && ev?.agentId && ev?.summary) {
          try {
            db.prepare(`
              INSERT OR IGNORE INTO evidence_records (
                id, mission_id, task_id, agent_id, agent_name, timestamp, action_type, summary, details_json, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              ev.id,
              ev.missionId || null,
              ev.taskId || null,
              ev.agentId,
              ev.agentName || 'Agent',
              ev.timestamp || new Date().toISOString(),
              ev.actionType || 'model_call',
              ev.summary,
              typeof ev.details === 'string' ? ev.details : JSON.stringify(ev.details || {}),
              ev.status || 'success'
            );
            importedEvidenceCount++;
          } catch {}
        }
      }
    }

    logAuditEvent('WORKSPACE_IMPORT', `Imported ${importedSpacesCount} spaces, ${importedDocsCount} docs, ${importedMissionsCount} missions, ${importedEvidenceCount} evidence logs`, 'success');

    return NextResponse.json({
      success: true,
      importedSpacesCount,
      importedDocsCount,
      importedMissionsCount,
      importedEvidenceCount,
      importedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Import error' }, { status: 500 });
  }
}

import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";

type ActivityAction = "create" | "update" | "delete";

interface LogActivityInput {
  userId: number | null;
  action: ActivityAction;
  entityType: string; // 'lot_sheet' | 'lot' | 'surveyor' | ...
  entityId?: number | null;
  description: string; // pre-built human-readable sentence
  changes?: Record<string, unknown> | null;
}

// Fire-and-forget by design: a logging failure should never break the
// actual create/update/delete it's describing. Pass `client` when calling
// this inside an existing transaction so the log lives or dies with the
// operation it's describing; omit it to use the shared pool directly.
export async function logActivity(
  input: LogActivityInput,
  client?: PoolClient
) {
  const executor = client ?? getPool();
  try {
    await executor.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description, changes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.userId,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.description,
        input.changes ? JSON.stringify(input.changes) : null,
      ]
    );
  } catch (err) {
    console.error("Failed to write activity log:", err);
  }
}
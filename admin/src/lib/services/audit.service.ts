// HIPAA audit console (L1/L2, §164.312(b)) admin client.
// Backend: backend/src/auth/auth.controller.ts (/api/v2/auth/training-ack).
// L2 will extend this with the AccessLog / AuthLog read endpoints.
import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export interface TrainingAckStatus {
  /** True only when the reviewer has acknowledged the CURRENT ROB version. */
  acknowledged: boolean
  /** The current Rules-of-Behavior version the reviewer is being held to. */
  version: string
  /** When the current-version acknowledgment was recorded (null if none). */
  ackedAt: string | null
}

/** GET the signed-in reviewer's Rules-of-Behavior acknowledgment status. */
export async function getTrainingAckStatus(): Promise<TrainingAckStatus> {
  const res = await fetchWithAuth(`${API}/api/v2/auth/training-ack`)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

/** POST — record that the reviewer acknowledges the current Rules of Behavior. */
export async function acknowledgeTraining(): Promise<{ recorded: boolean; version: string }> {
  const res = await fetchWithAuth(`${API}/api/v2/auth/training-ack`, { method: 'POST' })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

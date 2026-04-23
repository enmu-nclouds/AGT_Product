// factoryApi.ts — typed wrappers for the factory sensor monitoring API.
// Base URL is read from VITE_API_URL (set in .env.local for dev, injected at build for prod).

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? ""

const JSON_HEADERS = { "Content-Type": "application/json" }

// ── Types ─────────────────────────────────────────────────────────────────────

export type MachineId =
  | "Pump-01"
  | "Compressor-01"
  | "Motor-01"
  | "Conveyor-01"
  | "Turbine-01"

export type ReadingStatus = "normal" | "warning" | "critical"

export interface SensorReading {
  machine_id: string
  timestamp: string
  temperature_c: number
  vibration_mms: number
  pressure_bar: number
  rpm: number
  status: ReadingStatus
}

export interface GenerateResponse {
  success: boolean
  count: number
}

export interface ChatResponse {
  response: string
  session_id: string
}

export interface ReportResponse {
  report: string
}

// ── API functions ──────────────────────────────────────────────────────────────

/** POST /generate — creates 20 synthetic sensor readings for all machines */
export async function generateData(): Promise<GenerateResponse> {
  const res = await fetch(`${API_URL}/generate`, {
    method: "POST",
    headers: JSON_HEADERS,
  })
  if (!res.ok) throw new Error(`Generate failed: ${res.status} ${res.statusText}`)
  return res.json()
}

/** GET /readings — returns up to `limit` latest readings for the given machine */
export async function getReadings(
  machineId: MachineId,
  limit = 10
): Promise<SensorReading[]> {
  const url = `${API_URL}/readings?machine_id=${encodeURIComponent(machineId)}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Readings fetch failed: ${res.status} ${res.statusText}`)
  return res.json()
}

/** POST /chat — sends a message, returns agent reply and session ID */
export async function sendChatMessage(
  message: string,
  sessionId: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  if (!res.ok) throw new Error(`Chat failed: ${res.status} ${res.statusText}`)
  return res.json()
}

/** POST /report — generates an AI performance report for the given machine */
export async function generateReport(machineId: MachineId): Promise<ReportResponse> {
  const res = await fetch(`${API_URL}/report`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ machine_id: machineId }),
  })
  if (!res.ok) throw new Error(`Report failed: ${res.status} ${res.statusText}`)
  return res.json()
}

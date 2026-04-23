// ReadingsTable — sensor readings table with colour-coded status badges.

import { SensorReading } from "@/services/factoryApi"

interface ReadingsTableProps {
  machineId: string
  readings: SensorReading[]
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return iso
  }
}

const STATUS_CLASSES: Record<string, string> = {
  normal:   "bg-green-900/60 text-green-300 border border-green-700",
  warning:  "bg-amber-900/60 text-amber-300 border border-amber-700",
  critical: "bg-red-900/60  text-red-300   border border-red-700",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${
        STATUS_CLASSES[status] ?? "bg-gray-700 text-gray-300"
      }`}
    >
      {status}
    </span>
  )
}

export function ReadingsTable({ machineId, readings }: ReadingsTableProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <h2 className="flex-none text-sm font-semibold text-gray-300 px-4 pt-4 pb-2">
        Live Readings —{" "}
        <span className="text-white">{machineId}</span>
      </h2>

      {readings.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm px-4 text-center">
          No data yet — click{" "}
          <span className="mx-1 font-semibold text-blue-400">Generate Sensor Data</span>{" "}
          to start.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-700">
                {["Time", "Temp (°C)", "Vibration (mm/s)", "Pressure (bar)", "RPM", "Status"].map(
                  (h) => (
                    <th
                      key={h}
                      className="py-2 pr-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {readings.map((r, i) => (
                <tr
                  key={`${r.machine_id}-${r.timestamp}-${i}`}
                  className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="py-1.5 pr-3 font-mono text-xs text-gray-400">
                    {formatTime(r.timestamp)}
                  </td>
                  <td
                    className={`py-1.5 pr-3 font-mono ${
                      r.temperature_c > 140
                        ? "text-red-400"
                        : r.temperature_c > 110
                        ? "text-amber-400"
                        : "text-gray-200"
                    }`}
                  >
                    {r.temperature_c}
                  </td>
                  <td
                    className={`py-1.5 pr-3 font-mono ${
                      r.vibration_mms > 5
                        ? "text-red-400"
                        : r.vibration_mms > 4
                        ? "text-amber-400"
                        : "text-gray-200"
                    }`}
                  >
                    {r.vibration_mms}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-gray-200">{r.pressure_bar}</td>
                  <td className="py-1.5 pr-3 font-mono text-gray-200">{r.rpm}</td>
                  <td className="py-1.5">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

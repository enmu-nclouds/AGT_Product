"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { Button } from "@/components/ui/button"
import { MachineId, getReadings, SensorReading } from "@/services/factoryApi"
import { MachineSelector } from "@/components/dashboard/MachineSelector"
import { ReadingsTable } from "@/components/dashboard/ReadingsTable"
import { FactoryChat } from "@/components/dashboard/FactoryChat"
import { ReportModal } from "@/components/dashboard/ReportModal"

const SESSION_ID = crypto.randomUUID()

export default function ChatPage() {
  const { isAuthenticated, signIn } = useAuth()

  const [selectedMachine, setSelectedMachine] = useState<MachineId>("Pump-01")
  const [readings, setReadings] = useState<SensorReading[]>([])
  const [report, setReport] = useState<string | null>(null)

  const fetchReadings = useCallback(async () => {
    try {
      const data = await getReadings(selectedMachine, 20)
      setReadings(data)
    } catch {
      // silently ignore — table shows empty state
    }
  }, [selectedMachine])

  useEffect(() => {
    if (!isAuthenticated) return
    setReadings([])
    fetchReadings()
  }, [isAuthenticated, fetchReadings])

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-4xl">Please sign in</p>
        <Button onClick={() => signIn()}>Sign In</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      {/* Top bar */}
      <header className="flex-none px-6 py-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Factory Sensor Monitoring
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Real-time equipment telemetry</p>
        </div>
        <MachineSelector
          selectedMachine={selectedMachine}
          onMachineChange={(m) => {
            setSelectedMachine(m)
            setReadings([])
          }}
          onDataGenerated={fetchReadings}
          onReportReady={(r) => setReport(r)}
        />
      </header>

      {/* Main content — readings left (60%), chat right (40%) */}
      <div className="flex flex-1 min-h-0 divide-x divide-gray-800">
        <div className="w-3/5 min-h-0">
          <ReadingsTable machineId={selectedMachine} readings={readings} />
        </div>
        <div className="w-2/5 min-h-0">
          <FactoryChat sessionId={SESSION_ID} />
        </div>
      </div>

      {/* Report modal overlay */}
      {report !== null && (
        <ReportModal
          machineId={selectedMachine}
          report={report}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  )
}

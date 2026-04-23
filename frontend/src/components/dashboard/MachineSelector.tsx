// MachineSelector — machine dropdown, Generate Sensor Data, and Generate Report buttons.

import { useState } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, FileText } from "lucide-react"
import { MachineId, generateData, generateReport } from "@/services/factoryApi"

const MACHINES: MachineId[] = [
  "Pump-01",
  "Compressor-01",
  "Motor-01",
  "Conveyor-01",
  "Turbine-01",
]

interface MachineSelectorProps {
  selectedMachine: MachineId
  onMachineChange: (machine: MachineId) => void
  onDataGenerated: () => void
  onReportReady: (report: string) => void
}

export function MachineSelector({
  selectedMachine,
  onMachineChange,
  onDataGenerated,
  onReportReady,
}: MachineSelectorProps) {
  const [generating, setGenerating] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [repError, setRepError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setGenerating(true)
    setGenError(null)
    try {
      await generateData()
      onDataGenerated()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to generate data")
    } finally {
      setGenerating(false)
    }
  }

  const handleReport = async () => {
    setReporting(true)
    setRepError(null)
    try {
      const { report } = await generateReport(selectedMachine)
      onReportReady(report)
    } catch (err) {
      setRepError(err instanceof Error ? err.message : "Failed to generate report")
    } finally {
      setReporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedMachine}
          onValueChange={(v) => onMachineChange(v as MachineId)}
        >
          <SelectTrigger className="w-44 bg-gray-800 border-gray-600 text-white">
            <SelectValue placeholder="Select machine" />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700 text-white">
            {MACHINES.map((m) => (
              <SelectItem key={m} value={m} className="hover:bg-gray-700 focus:bg-gray-700">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={handleGenerate}
          disabled={generating}
          variant="outline"
          size="sm"
          className="border-gray-600 text-gray-300 hover:bg-gray-700"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Generate Sensor Data
        </Button>

        <Button
          onClick={handleReport}
          disabled={reporting}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700"
        >
          {reporting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <FileText className="w-4 h-4 mr-2" />
          )}
          Generate Report
        </Button>
      </div>

      {genError && (
        <p className="text-xs text-red-400">{genError}</p>
      )}
      {repError && (
        <p className="text-xs text-red-400">{repError}</p>
      )}
    </div>
  )
}

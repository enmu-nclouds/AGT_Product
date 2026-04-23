// ReportModal — modal overlay displaying the AI-generated performance report.

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { X, Copy, Check } from "lucide-react"

interface ReportModalProps {
  machineId: string
  report: string
  onClose: () => void
}

export function ReportModal({ machineId, report, onClose }: ReportModalProps) {
  const [copied, setCopied] = useState(false)
  const backdropRef = useRef<HTMLDivElement>(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available in all contexts
    }
  }

  // Close when clicking the dark backdrop, not the modal card
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="relative w-full max-w-2xl max-h-[80vh] flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-none">
          <div>
            <h2 className="text-base font-semibold text-white">Performance Report</h2>
            <p className="text-xs text-gray-400 mt-0.5">{machineId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded"
            aria-label="Close report"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Report body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          <pre className="whitespace-pre-wrap text-sm text-gray-200 font-mono leading-relaxed">
            {report}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700 flex-none">
          <Button
            onClick={handleCopy}
            variant="outline"
            size="sm"
            className="border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-1.5 text-green-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1.5" />
                Copy to Clipboard
              </>
            )}
          </Button>
          <Button
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-white"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

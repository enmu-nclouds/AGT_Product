// FactoryChat — simple request/response chat panel wired to POST /chat.

import { useEffect, useRef, useState } from "react"
import { sendChatMessage } from "@/services/factoryApi"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Send } from "lucide-react"

interface ChatMessage {
  role: "user" | "assistant" | "error"
  content: string
}

interface FactoryChatProps {
  sessionId: string
}

export function FactoryChat({ sessionId }: FactoryChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: text }])
    setLoading(true)

    try {
      const data = await sendChatMessage(text, sessionId)
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response },
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setMessages((prev) => [
        ...prev,
        { role: "error", content: `Error: ${msg}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex-none px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold text-gray-300">AI Assistant</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Tip: ask about readings, or type{" "}
          <span className="text-blue-400 font-medium">&ldquo;manual&rdquo;</span> to
          query machine documentation.
        </p>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-gray-600 text-sm text-center mt-10">
            Ask about sensor readings or machine manuals…
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === "user"
                  ? "bg-blue-700 text-white"
                  : m.role === "error"
                  ? "bg-red-900/60 text-red-300 border border-red-700"
                  : "bg-gray-800 text-gray-200 border border-gray-700"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input row */}
      <div className="flex-none px-4 pb-4 pt-2 border-t border-gray-700">
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about sensor readings or machine manuals…"
            rows={2}
            className="resize-none flex-1 bg-gray-800 border-gray-600 text-white placeholder-gray-500 text-sm"
          />
          <Button
            onClick={send}
            disabled={!input.trim() || loading}
            size="icon"
            className="bg-blue-600 hover:bg-blue-700 shrink-0 self-end"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

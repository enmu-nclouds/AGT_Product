// sensor-chat-handler
// POST /chat  body: { message, session_id?, agent_type? }
//
// Routing logic:
//   if message contains "manual" / "procedure" / "specification" / "how to" / "safety" /
//   "maintenance" / "troubleshoot"  →  Agent 2 (KB / documentation agent)
//   otherwise                        →  Agent 1 (sensor data agent)
//
// Agent IDs are set via Lambda env vars after manual creation in the AWS console.
// See README §"Manual steps: Create Bedrock Agents" for instructions.

"use strict"

const {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} = require("@aws-sdk/client-bedrock-agent-runtime")

const DATA_AGENT_ID    = process.env.DATA_AGENT_ID
const DATA_AGENT_ALIAS = process.env.DATA_AGENT_ALIAS_ID
const KB_AGENT_ID      = process.env.KB_AGENT_ID
const KB_AGENT_ALIAS   = process.env.KB_AGENT_ALIAS_ID
const REGION           = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || "us-east-1"

// Keywords that indicate a documentation / manual query → route to KB agent
const KB_KEYWORDS = [
  "manual", "procedure", "specification", "how to", "safety",
  "maintenance", "troubleshoot", "repair", "spare part", "shutdown",
]

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

const client = new BedrockAgentRuntimeClient({ region: REGION })

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" }
  }

  let body
  try {
    body = JSON.parse(event.body || "{}")
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid JSON body" }) }
  }

  const { message, session_id, agent_type } = body

  if (!message || typeof message !== "string") {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "message is required" }) }
  }

  // Route: explicit agent_type overrides keyword detection
  const lower = message.toLowerCase()
  const useKbAgent = agent_type === "kb" || KB_KEYWORDS.some(kw => lower.includes(kw))

  const agentId    = useKbAgent ? KB_AGENT_ID    : DATA_AGENT_ID
  const agentAlias = useKbAgent ? KB_AGENT_ALIAS : DATA_AGENT_ALIAS
  const sessionId  = session_id || crypto.randomUUID()

  // Guard: agents not yet configured (PLACEHOLDER values from initial CDK deploy)
  if (!agentId || agentId === "PLACEHOLDER" || !agentAlias || agentAlias === "PLACEHOLDER") {
    const whichAgent = useKbAgent ? "KB agent (Agent 2)" : "data agent (Agent 1)"
    return {
      statusCode: 503,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: `${whichAgent} is not configured yet. ` +
               "Create it in the Bedrock console then update the Lambda environment variables. " +
               "See README §'Manual steps: Create Bedrock Agents'.",
        session_id: sessionId,
      }),
    }
  }

  // Invoke the Bedrock agent and collect the streaming response
  const command = new InvokeAgentCommand({
    agentId,
    agentAliasId: agentAlias,
    sessionId,
    inputText: message,
  })

  let reply = ""
  try {
    const response = await client.send(command)
    for await (const chunk of response.completion) {
      if (chunk.chunk?.bytes) {
        reply += Buffer.from(chunk.chunk.bytes).toString("utf-8")
      }
    }
  } catch (err) {
    console.error("Bedrock agent invocation error:", err)
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Agent invocation failed: ${err.message}`, session_id: sessionId }),
    }
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ response: reply, session_id: sessionId }),
  }
}

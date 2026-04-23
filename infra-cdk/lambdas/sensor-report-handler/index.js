// sensor-report-handler
// POST /report  body: { machine_id }
//
// Fetches the last 50 readings for the machine from DynamoDB, then calls
// Bedrock InvokeModel (claude-sonnet-4-20250514) directly — no Bedrock Agent needed.
// Returns { report: "plain text report" }.

"use strict"

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb")
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb")
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime")

const TABLE_NAME    = process.env.DYNAMODB_TABLE_NAME
const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1"
// Cross-region inference profile for Claude Sonnet 4 in us-east-1
const MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0"

const ddb     = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const bedrock = new BedrockRuntimeClient({ region: BEDROCK_REGION })

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

// Normal operating ranges — included in prompt so Claude can reason about them
const NORMAL_RANGES = `
Normal operating ranges:
  temperature_c:  60–120°C    (warning >110°C, critical >140°C)
  vibration_mms:  0.5–3.0 mm/s (warning >4 mm/s, critical >6 mm/s)
  pressure_bar:   2.0–8.0 bar
  rpm:            1000–3500
`.trim()

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" }
  }

  let body
  try {
    body = JSON.parse(event.body || "{}")
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Invalid JSON body" }) }
  }

  const { machine_id } = body
  if (!machine_id) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "machine_id is required" }) }
  }

  // Fetch the last 50 readings (sorted descending = most recent first)
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "machine_id = :mid",
    ExpressionAttributeValues: { ":mid": machine_id },
    ScanIndexForward: false,
    Limit: 50,
  }))

  const readings = result.Items || []

  if (readings.length === 0) {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        report: `No sensor data found for ${machine_id}. Click "Generate Sensor Data" first.`,
      }),
    }
  }

  // Format readings as a compact text table for the prompt
  const table = readings.map(r =>
    `${r.timestamp}  temp=${r.temperature_c}°C  vib=${r.vibration_mms}mm/s  ` +
    `pres=${r.pressure_bar}bar  rpm=${r.rpm}  status=${r.status}`
  ).join("\n")

  const prompt = `You are a factory equipment analyst. Below are the ${readings.length} most recent sensor readings for machine ${machine_id}, most recent first.

${NORMAL_RANGES}

Sensor readings:
${table}

Write a concise performance report with these exact sections:
1. Overall Status (1–2 sentences — is this machine healthy, degraded, or critical?)
2. Average Values (list avg temperature, vibration, pressure, RPM across all readings)
3. Anomalies (count and briefly describe each anomaly — timestamp, metric, value)
4. Trend (is the machine stable, improving, or degrading? 1–2 sentences)
5. Top 3 Recommended Actions (numbered list, practical and specific)

Use plain text only. Be concise — a field operator will read this.`

  let report
  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    }))

    const parsed = JSON.parse(Buffer.from(response.body).toString("utf-8"))
    report = parsed.content[0].text
  } catch (err) {
    console.error("Bedrock InvokeModel error:", err)
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Report generation failed: ${err.message}` }),
    }
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ report }),
  }
}

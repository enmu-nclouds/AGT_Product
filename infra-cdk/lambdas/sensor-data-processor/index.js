// sensor-data-processor
// Triggered by Kinesis stream (batch size 10).
// Writes each record to DynamoDB with a 7-day TTL.
// Logs anomalies to CloudWatch so operators can set metric-filter alarms.

"use strict"

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb")
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb")

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// TTL: 7 days from now (Unix epoch seconds)
function ttlSeconds() {
  return Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
}

exports.handler = async (event) => {
  let processed = 0
  let anomalies = 0

  for (const record of event.Records) {
    // Kinesis data is base64-encoded
    const raw  = Buffer.from(record.kinesis.data, "base64").toString("utf-8")
    const item = JSON.parse(raw)

    // Write to DynamoDB (upsert — same machine_id + timestamp is idempotent)
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...item, ttl: ttlSeconds() },
    }))

    processed++

    // Structured log so CloudWatch Insights / metric filters can catch anomalies
    if (item.status === "warning" || item.status === "critical") {
      console.log(JSON.stringify({
        level:       "ANOMALY",
        machine_id:  item.machine_id,
        status:      item.status,
        timestamp:   item.timestamp,
        temperature: item.temperature_c,
        vibration:   item.vibration_mms,
        pressure:    item.pressure_bar,
        rpm:         item.rpm,
      }))
      anomalies++
    }
  }

  console.log(`Processed ${processed} records, ${anomalies} anomalies.`)
}

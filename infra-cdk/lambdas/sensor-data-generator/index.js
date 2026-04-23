// sensor-data-generator
// POST /generate → generates 20 synthetic sensor readings, puts each onto Kinesis,
// saves full batch to S3. Returns { success: true, count: 20 }.
//
// Normal ranges:  temperature_c 60–120, vibration_mms 0.5–3.0, pressure_bar 2–8, rpm 1000–3500
// Anomaly ranges: temperature_c 150+,   vibration_mms 6+

"use strict"

const { KinesisClient, PutRecordsCommand } = require("@aws-sdk/client-kinesis")
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3")

const STREAM_NAME = process.env.KINESIS_STREAM_NAME
const RAW_BUCKET  = process.env.S3_RAW_BUCKET

const MACHINES = ["Pump-01", "Compressor-01", "Motor-01", "Conveyor-01", "Turbine-01"]

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

// Build one sensor reading, optionally injecting anomaly values
function makeReading(machineId, timestamp, anomaly) {
  const temp      = anomaly ? 150 + Math.random() * 25 : 60  + Math.random() * 60
  const vibration = anomaly ? 6   + Math.random() * 4  : 0.5 + Math.random() * 2.5
  const pressure  = 2.0 + Math.random() * 6.0
  const rpm       = Math.floor(1000 + Math.random() * 2500)

  // Derive status from the most-critical metric
  let status = "normal"
  if (temp > 140 || vibration > 5) status = "critical"
  else if (temp > 110 || vibration > 4) status = "warning"

  return {
    machine_id:    machineId,
    timestamp:     timestamp,
    temperature_c: Math.round(temp * 10) / 10,
    vibration_mms: Math.round(vibration * 100) / 100,
    pressure_bar:  Math.round(pressure * 10) / 10,
    rpm,
    status,
  }
}

exports.handler = async () => {
  const now = new Date()

  // Pick 1–2 random indices (out of 20) to be anomalies
  const anomalyCount = 1 + Math.floor(Math.random() * 2) // 1 or 2
  const anomalyIndices = new Set()
  while (anomalyIndices.size < anomalyCount) {
    anomalyIndices.add(Math.floor(Math.random() * 20))
  }

  // Generate 4 readings per machine, each 1 minute apart going back from now
  const readings = []
  let idx = 0
  for (const machine of MACHINES) {
    for (let i = 0; i < 4; i++) {
      // Reading[0] is oldest (19 min ago), reading[19] is most recent
      const ts = new Date(now.getTime() - (19 - idx) * 60_000).toISOString()
      readings.push(makeReading(machine, ts, anomalyIndices.has(idx)))
      idx++
    }
  }

  // Send all records to Kinesis in one batch call
  const kinesisClient = new KinesisClient({})
  await kinesisClient.send(new PutRecordsCommand({
    StreamName: STREAM_NAME,
    Records: readings.map(r => ({
      Data: Buffer.from(JSON.stringify(r)),
      PartitionKey: r.machine_id,
    })),
  }))

  // Persist the raw batch to S3 for audit / replay
  const batchKey = `batches/${now.toISOString().replace(/:/g, "-")}.json`
  const s3Client = new S3Client({})
  await s3Client.send(new PutObjectCommand({
    Bucket: RAW_BUCKET,
    Key: batchKey,
    Body: JSON.stringify({ generated_at: now.toISOString(), readings }),
    ContentType: "application/json",
  }))

  console.log(`Generated ${readings.length} readings, ${anomalyCount} anomalies. Batch: ${batchKey}`)

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, count: readings.length }),
  }
}

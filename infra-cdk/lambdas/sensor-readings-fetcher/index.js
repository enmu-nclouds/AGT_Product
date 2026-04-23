// sensor-readings-fetcher
// GET /readings?machine_id=Pump-01&limit=20
// Queries DynamoDB for the latest N readings for a given machine (most recent first).

"use strict"

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb")
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb")

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
}

exports.handler = async (event) => {
  const isBedrockCall = !!event.actionGroup

  // Bedrock Agent passes parameters as an array of { name, value } objects
  let machineId, limit
  if (isBedrockCall) {
    const params = {}
    for (const p of (event.parameters || [])) params[p.name] = p.value
    machineId = params.machine_id
    limit = Math.min(parseInt(params.limit || "20", 10), 100)
  } else {
    const params = event.queryStringParameters || {}
    machineId = params.machine_id
    limit = Math.min(parseInt(params.limit || "20", 10), 100)
  }

  if (!machineId) {
    if (isBedrockCall) {
      return {
        messageVersion: "1.0",
        response: {
          actionGroup: event.actionGroup,
          function: event.function,
          functionResponse: {
            responseBody: { TEXT: { body: "Error: machine_id parameter is required" } },
          },
        },
      }
    }
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "machine_id query parameter is required" }),
    }
  }

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "machine_id = :mid",
    ExpressionAttributeValues: { ":mid": machineId },
    ScanIndexForward: false, // descending sort — latest timestamp first
    Limit: limit,
  }))

  const readings = result.Items || []

  if (isBedrockCall) {
    return {
      messageVersion: "1.0",
      response: {
        actionGroup: event.actionGroup,
        function: event.function,
        functionResponse: {
          responseBody: { TEXT: { body: JSON.stringify(readings) } },
        },
      },
    }
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(readings),
  }
}

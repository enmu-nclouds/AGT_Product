# Factory Sensor Monitoring POC

A full-stack factory equipment telemetry application built on AWS. The frontend is a React dashboard for real-time sensor monitoring, AI-powered chat, and automated performance reports. The backend is serverless: API Gateway → Lambda → DynamoDB, with Bedrock for AI features.

## Architecture

### Frontend
- **React + Vite + Tailwind + shadcn/ui** hosted on AWS Amplify
- Machine selector (Pump-01, Compressor-01, Motor-01, Conveyor-01, Turbine-01)
- Live readings table with colour-coded status badges
- AI chat panel (routes to data agent or knowledge-base agent based on keywords)
- Performance report modal (AI-generated, copyable)

### Backend (serverless)
- **API Gateway** (REST) — `POST /generate`, `GET /readings`, `POST /chat`, `POST /report`
- **DynamoDB** — `factory-sensor-readings` (PK: `machine_id`, SK: `timestamp`, TTL: 7 days)
- **Kinesis Data Stream** — `factory-sensor-stream` (1 shard) — decouples generation from persistence
- **S3** — `factory-sensor-raw` (raw JSON archive) · `factory-sensor-knowledgebase` (manual PDFs)
- **Bedrock** — two agents + one knowledge base (see below)

### Lambda functions

| Function | Trigger | Purpose |
|---|---|---|
| `sensor-data-generator` | POST /generate | Generates 20 synthetic readings (4/machine) and puts them on Kinesis |
| `sensor-data-processor` | Kinesis stream | Writes each record to DynamoDB and archives JSON to S3 |
| `sensor-readings-fetcher` | GET /readings · Bedrock action group | Returns latest N readings for a machine; dual-format response |
| `sensor-chat-handler` | POST /chat | Routes to data agent or KB agent based on keyword detection |
| `sensor-report-handler` | POST /report | Fetches last 50 readings and calls Bedrock InvokeModel for a structured report |

### Bedrock resources (manual setup — see below)

| Resource | Details |
|---|---|
| Knowledge Base `factory-sensor-kb` | S3 source (`factory-sensor-knowledgebase`), Titan Embeddings v2, OpenSearch Serverless |
| Agent `factory-sensor-data-agent` | Action group backed by `sensor-readings-fetcher` |
| Agent `factory-kb-agent` | Knowledge base `factory-sensor-kb` attached |

Chat routing: messages containing `manual`, `procedure`, `specification`, `how to`, `safety`, `maintenance`, `troubleshoot`, `repair`, `spare part`, or `shutdown` go to the KB agent. All others go to the data agent.

## Sensor data schema

```json
{
  "machine_id": "Pump-01",
  "timestamp": "2025-01-15T10:23:45.123Z",
  "temperature_c": 95.4,
  "vibration_mms": 2.1,
  "pressure_bar": 5.2,
  "rpm": 2200,
  "status": "normal"
}
```

Normal operating ranges:

| Metric | Normal | Warning | Critical |
|---|---|---|---|
| Temperature (°C) | 60–120 | > 110 | > 140 |
| Vibration (mm/s) | 0.5–3.0 | > 4 | > 6 |
| Pressure (bar) | 2.0–8.0 | — | — |
| RPM | 1000–3500 | — | — |

## Deployment

### Prerequisites
- Node.js 20+
- AWS CLI configured (`aws configure`)
- CDK bootstrapped (`cdk bootstrap`)

### 1 — Deploy infrastructure

```bash
cd infra-cdk
npm install
cdk deploy
```

Note the stack outputs — you'll need `FactoryApiUrl`, `CognitoUserPoolId`, and `CognitoClientId`.

### 2 — Upload knowledge-base documents

```bash
aws s3 cp infra-cdk/knowledge-base-docs/ \
  s3://<factory-sensor-knowledgebase-bucket>/ --recursive
```

### 3 — Create Bedrock resources (AWS Console)

#### Knowledge Base
1. Bedrock → Knowledge Bases → Create
2. Name: `factory-sensor-kb`
3. Data source: S3 → select the `factory-sensor-knowledgebase` bucket
4. Embeddings model: Titan Embeddings v2
5. Vector store: OpenSearch Serverless (auto-create)
6. Sync the data source after creation

#### Data Agent (`factory-sensor-data-agent`)
1. Bedrock → Agents → Create
2. Model: Claude Sonnet 4 (or equivalent)
3. Instructions: *"You are a factory equipment analyst. Use the get_sensor_readings action to fetch live sensor data for any machine and answer questions about readings, status, trends, and anomalies."*
4. Add action group → Lambda: `sensor-readings-fetcher`
5. Define function: `get_sensor_readings` with parameters `machine_id` (string, required) and `limit` (integer, optional)
6. Create an agent alias

#### KB Agent (`factory-kb-agent`)
1. Bedrock → Agents → Create
2. Model: Claude Sonnet 4 (or equivalent)
3. Instructions: *"You are a factory equipment expert. Use the attached knowledge base to answer questions about machine manuals, operating procedures, maintenance schedules, safety protocols, and spare parts."*
4. Associate knowledge base: `factory-sensor-kb`
5. Create an agent alias

### 4 — Set agent IDs on the chat Lambda

```bash
aws lambda update-function-configuration \
  --function-name <sensor-chat-handler-name> \
  --environment "Variables={
    DYNAMODB_TABLE_NAME=<table>,
    DATA_AGENT_ID=<data-agent-id>,
    DATA_AGENT_ALIAS_ID=<data-agent-alias-id>,
    KB_AGENT_ID=<kb-agent-id>,
    KB_AGENT_ALIAS_ID=<kb-agent-alias-id>
  }"
```

### 5 — Configure and deploy the frontend

```bash
cp frontend/.env.example frontend/.env.local
# Edit frontend/.env.local with your values
```

```
VITE_API_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/prod
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

```bash
cd infra-cdk
python ../scripts/deploy-frontend.py
```

## Project structure

```
.
├── frontend/                    # React + Vite dashboard
│   └── src/
│       ├── components/dashboard/  # MachineSelector, ReadingsTable, FactoryChat, ReportModal
│       ├── routes/ChatPage.tsx    # Main dashboard page
│       └── services/factoryApi.ts # Typed API wrappers
├── infra-cdk/
│   ├── lib/
│   │   ├── backend-stack.ts       # DynamoDB, Kinesis, S3, Lambdas, API Gateway
│   │   ├── cognito-stack.ts       # Cognito User Pool
│   │   ├── amplify-hosting-stack.ts
│   │   └── fast-main-stack.ts     # Root stack
│   ├── lambdas/
│   │   ├── sensor-data-generator/
│   │   ├── sensor-data-processor/
│   │   ├── sensor-readings-fetcher/
│   │   ├── sensor-chat-handler/
│   │   └── sensor-report-handler/
│   └── knowledge-base-docs/       # pump-manual.txt, compressor-manual.txt, general-safety-procedures.txt
└── scripts/
    └── deploy-frontend.py
```

## Security

This is a proof-of-concept and is not intended as a production-ready solution. CORS is open (`*`) and there is no API Gateway authorizer on the factory endpoints. Before production use, add a Cognito authorizer to the API Gateway routes and restrict CORS to your Amplify domain.

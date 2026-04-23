// Factory Sensor Monitor — Backend Stack
// Replaces AgentCore-specific resources with factory sensor monitoring infrastructure.
// Kept from FAST baseline: Feedback DynamoDB table, Feedback API, Cognito SSM params.
// Added: S3 buckets, Kinesis stream, DynamoDB readings table, 5 Lambda functions, REST API.

import * as cdk from "aws-cdk-lib"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as iam from "aws-cdk-lib/aws-iam"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as logs from "aws-cdk-lib/aws-logs"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as kinesis from "aws-cdk-lib/aws-kinesis"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambda_events from "aws-cdk-lib/aws-lambda-event-sources"
// PythonFunction removed: it requires Docker at synth time to bundle pip deps.
// The feedback Lambda only uses the Powertools layer (which already bundles pydantic),
// so a plain lambda.Function + fromAsset() is sufficient and Docker-free.
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"
import * as path from "path"

export interface BackendStackProps extends cdk.NestedStackProps {
  config: AppConfig
  userPoolId: string
  userPoolClientId: string
  userPoolDomain: cognito.UserPoolDomain
  frontendUrl: string
}

export class BackendStack extends cdk.NestedStack {
  public readonly userPoolId: string
  public readonly userPoolClientId: string
  public readonly userPoolDomain: cognito.UserPoolDomain
  public feedbackApiUrl: string
  public factoryApiUrl: string
  private userPool: cognito.IUserPool

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props)

    this.userPoolId = props.userPoolId
    this.userPoolClientId = props.userPoolClientId
    this.userPoolDomain = props.userPoolDomain

    this.userPool = cognito.UserPool.fromUserPoolId(
      this,
      "ImportedUserPool",
      props.userPoolId
    )

    // Store Cognito config in SSM for scripts / runtime access
    this.createCognitoSSMParameters(props.config)

    // ── FAST baseline: Feedback system (kept as-is) ──────────────────────────
    const feedbackTable = this.createFeedbackTable(props.config)
    this.createFeedbackApi(props.config, props.frontendUrl, feedbackTable)

    // ── Factory sensor monitoring resources ───────────────────────────────────
    this.createFactoryResources(props.config)
  }

  // ── Factory resources ────────────────────────────────────────────────────────

  private createFactoryResources(config: AppConfig): void {
    // S3: raw sensor batches from the generator Lambda
    const rawBucket = new s3.Bucket(this, "SensorRawBucket", {
      bucketName: `factory-sensor-raw-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    // S3: machine manuals / knowledge base source documents
    const kbBucket = new s3.Bucket(this, "SensorKnowledgebaseBucket", {
      bucketName: `factory-sensor-knowledgebase-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    // Kinesis Data Stream — 1 shard, receives individual sensor records
    const sensorStream = new kinesis.Stream(this, "SensorStream", {
      streamName: "factory-sensor-stream",
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
    })

    // DynamoDB: sensor readings (PK: machine_id, SK: timestamp, TTL: ttl)
    const readingsTable = new dynamodb.Table(this, "SensorReadingsTable", {
      tableName: "factory-sensor-readings",
      partitionKey: { name: "machine_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Broad Lambda execution role for POC — gives full access to DynamoDB, Kinesis, S3, Bedrock
    const lambdaRole = new iam.Role(this, "FactoryLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonKinesisFullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonBedrockFullAccess"),
      ],
    })

    // ── Lambda: sensor-data-generator ────────────────────────────────────────
    // Triggered by POST /generate — creates 20 synthetic readings, sends to Kinesis + S3
    const generatorFn = new lambda.Function(this, "SensorDataGenerator", {
      functionName: "sensor-data-generator",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambdas", "sensor-data-generator") // nosemgrep
      ),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      environment: {
        KINESIS_STREAM_NAME: sensorStream.streamName,
        S3_RAW_BUCKET: rawBucket.bucketName,
      },
      logGroup: new logs.LogGroup(this, "GeneratorLogGroup", {
        logGroupName: "/aws/lambda/sensor-data-generator",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // ── Lambda: sensor-data-processor ────────────────────────────────────────
    // Triggered by Kinesis stream (batch 10) — writes each record to DynamoDB
    const processorFn = new lambda.Function(this, "SensorDataProcessor", {
      functionName: "sensor-data-processor",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambdas", "sensor-data-processor") // nosemgrep
      ),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      environment: {
        DYNAMODB_TABLE_NAME: readingsTable.tableName,
      },
      logGroup: new logs.LogGroup(this, "ProcessorLogGroup", {
        logGroupName: "/aws/lambda/sensor-data-processor",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // Wire Kinesis → processor Lambda
    processorFn.addEventSource(
      new lambda_events.KinesisEventSource(sensorStream, {
        batchSize: 10,
        startingPosition: lambda.StartingPosition.LATEST,
      })
    )

    // ── Lambda: sensor-readings-fetcher ──────────────────────────────────────
    // Triggered by GET /readings — queries DynamoDB for latest N readings per machine
    const fetcherFn = new lambda.Function(this, "SensorReadingsFetcher", {
      functionName: "sensor-readings-fetcher",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambdas", "sensor-readings-fetcher") // nosemgrep
      ),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DYNAMODB_TABLE_NAME: readingsTable.tableName,
      },
      logGroup: new logs.LogGroup(this, "FetcherLogGroup", {
        logGroupName: "/aws/lambda/sensor-readings-fetcher",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // ── Lambda: sensor-chat-handler ───────────────────────────────────────────
    // Triggered by POST /chat — routes to Bedrock Agent 1 (data) or Agent 2 (KB)
    // Set DATA_AGENT_ID, DATA_AGENT_ALIAS_ID, KB_AGENT_ID, KB_AGENT_ALIAS_ID
    // after creating the agents manually in the AWS console (see README).
    const chatFn = new lambda.Function(this, "SensorChatHandler", {
      functionName: "sensor-chat-handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambdas", "sensor-chat-handler") // nosemgrep
      ),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      environment: {
        // Populate these after manually creating the Bedrock agents in the console
        DATA_AGENT_ID: "PLACEHOLDER",
        DATA_AGENT_ALIAS_ID: "PLACEHOLDER",
        KB_AGENT_ID: "PLACEHOLDER",
        KB_AGENT_ALIAS_ID: "PLACEHOLDER",
        AWS_BEDROCK_REGION: this.region,
      },
      logGroup: new logs.LogGroup(this, "ChatLogGroup", {
        logGroupName: "/aws/lambda/sensor-chat-handler",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // ── Lambda: sensor-report-handler ─────────────────────────────────────────
    // Triggered by POST /report — fetches 50 readings then calls Bedrock InvokeModel
    const reportFn = new lambda.Function(this, "SensorReportHandler", {
      functionName: "sensor-report-handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambdas", "sensor-report-handler") // nosemgrep
      ),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      environment: {
        DYNAMODB_TABLE_NAME: readingsTable.tableName,
        BEDROCK_REGION: "us-east-1",
      },
      logGroup: new logs.LogGroup(this, "ReportLogGroup", {
        logGroupName: "/aws/lambda/sensor-report-handler",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    // ── REST API Gateway (open, no auth — Cognito auth is frontend-only for POC) ──
    const api = new apigateway.RestApi(this, "FactoryApi", {
      restApiName: "factory-sensor-api",
      description: "Factory sensor monitoring API — POC (no gateway auth)",
      defaultCorsPreflightOptions: {
        // Allow all origins for POC; tighten in production
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        metricsEnabled: true,
      },
    })

    // POST /generate
    const generateResource = api.root.addResource("generate")
    generateResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(generatorFn),
      { authorizationType: apigateway.AuthorizationType.NONE }
    )

    // GET /readings?machine_id=X&limit=N
    const readingsResource = api.root.addResource("readings")
    readingsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(fetcherFn),
      { authorizationType: apigateway.AuthorizationType.NONE }
    )

    // POST /chat
    const chatResource = api.root.addResource("chat")
    chatResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(chatFn),
      { authorizationType: apigateway.AuthorizationType.NONE }
    )

    // POST /report
    const reportResource = api.root.addResource("report")
    reportResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(reportFn),
      { authorizationType: apigateway.AuthorizationType.NONE }
    )

    this.factoryApiUrl = api.url

    // Store API URL in SSM for easy retrieval
    new ssm.StringParameter(this, "FactoryApiUrlParam", {
      parameterName: `/${config.stack_name_base}/factory-api-url`,
      stringValue: api.url,
      description: "Factory sensor monitoring API URL",
    })

    // Store bucket name for post-deploy upload step
    new ssm.StringParameter(this, "KbBucketNameParam", {
      parameterName: `/${config.stack_name_base}/kb-bucket-name`,
      stringValue: kbBucket.bucketName,
      description: "S3 bucket name for Bedrock Knowledge Base documents",
    })

    // Outputs
    new cdk.CfnOutput(this, "FactoryApiUrl", {
      value: api.url,
      description: "Factory sensor monitoring REST API URL",
    })

    new cdk.CfnOutput(this, "SensorRawBucketName", {
      value: rawBucket.bucketName,
      description: "S3 bucket for raw sensor batches",
    })

    new cdk.CfnOutput(this, "KnowledgebaseBucketName", {
      value: kbBucket.bucketName,
      description: "S3 bucket for KB documents — upload manuals here after deploy",
    })

    new cdk.CfnOutput(this, "SensorStreamName", {
      value: sensorStream.streamName,
      description: "Kinesis stream for sensor records",
    })

    new cdk.CfnOutput(this, "ReadingsTableName", {
      value: readingsTable.tableName,
      description: "DynamoDB table for sensor readings",
    })

    new cdk.CfnOutput(this, "ChatHandlerNote", {
      value: "Set DATA_AGENT_ID, DATA_AGENT_ALIAS_ID, KB_AGENT_ID, KB_AGENT_ALIAS_ID on sensor-chat-handler after creating agents",
      description: "Post-deploy manual step for chat Lambda",
    })
  }

  // ── Cognito SSM parameters (simplified — M2M removed) ───────────────────────

  private createCognitoSSMParameters(config: AppConfig): void {
    new ssm.StringParameter(this, "CognitoUserPoolIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-id`,
      stringValue: this.userPoolId,
      description: "Cognito User Pool ID",
    })

    new ssm.StringParameter(this, "CognitoUserPoolClientIdParam", {
      parameterName: `/${config.stack_name_base}/cognito-user-pool-client-id`,
      stringValue: this.userPoolClientId,
      description: "Cognito User Pool Client ID",
    })

    new ssm.StringParameter(this, "CognitoDomainParam", {
      parameterName: `/${config.stack_name_base}/cognito_provider`,
      stringValue: `${this.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito domain URL",
    })
  }

  // ── FAST baseline: Feedback table (kept unchanged) ───────────────────────────

  private createFeedbackTable(config: AppConfig): dynamodb.Table {
    const feedbackTable = new dynamodb.Table(this, "FeedbackTable", {
      tableName: `${config.stack_name_base}-feedback`,
      partitionKey: {
        name: "feedbackId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    })

    feedbackTable.addGlobalSecondaryIndex({
      indexName: "feedbackType-timestamp-index",
      partitionKey: {
        name: "feedbackType",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    return feedbackTable
  }

  // ── FAST baseline: Feedback API (kept unchanged) ─────────────────────────────

  private createFeedbackApi(
    config: AppConfig,
    frontendUrl: string,
    feedbackTable: dynamodb.Table
  ): void {
    // Plain lambda.Function avoids the Docker-at-synth requirement of PythonFunction.
    // All dependencies (aws_lambda_powertools, pydantic) are provided by the Powertools layer.
    const feedbackLambda = new lambda.Function(this, "FeedbackLambda", {
      functionName: `${config.stack_name_base}-feedback`,
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      // handler: <module_name>.<function_name> — file is index.py, function is handler
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambdas", "feedback")), // nosemgrep
      environment: {
        TABLE_NAME: feedbackTable.tableName,
        CORS_ALLOWED_ORIGINS: `${frontendUrl},http://localhost:3000`,
      },
      timeout: cdk.Duration.seconds(30),
      layers: [
        // Powertools v3 layer bundles aws-lambda-powertools AND pydantic v2 — no pip install needed
        lambda.LayerVersion.fromLayerVersionArn(
          this,
          "PowertoolsLayer",
          `arn:aws:lambda:${cdk.Stack.of(this).region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-python313-arm64:18`
        ),
      ],
      logGroup: new logs.LogGroup(this, "FeedbackLambdaLogGroup", {
        logGroupName: `/aws/lambda/${config.stack_name_base}-feedback`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    })

    feedbackTable.grantWriteData(feedbackLambda)

    const api = new apigateway.RestApi(this, "FeedbackApi", {
      restApiName: `${config.stack_name_base}-api`,
      description: "API for user feedback",
      defaultCorsPreflightOptions: {
        allowOrigins: [frontendUrl, "http://localhost:3000"],
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
    })

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "FeedbackApiAuthorizer", {
      cognitoUserPools: [this.userPool],
      identitySource: "method.request.header.Authorization",
      authorizerName: `${config.stack_name_base}-authorizer`,
    })

    const feedbackResource = api.root.addResource("feedback")
    feedbackResource.addMethod("POST", new apigateway.LambdaIntegration(feedbackLambda), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    })

    this.feedbackApiUrl = api.url

    new ssm.StringParameter(this, "FeedbackApiUrlParam", {
      parameterName: `/${config.stack_name_base}/feedback-api-url`,
      stringValue: api.url,
      description: "Feedback API Gateway URL",
    })
  }
}

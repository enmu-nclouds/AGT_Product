// Factory Sensor Monitor — Main CDK Stack
// Orchestrates: AmplifyHostingStack, CognitoStack, BackendStack (factory-extended).
// AgentCore Runtime / Memory outputs removed — replaced by FactoryApiUrl.

import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { AppConfig } from "./utils/config-manager"

import { BackendStack } from "./backend-stack"
import { AmplifyHostingStack } from "./amplify-hosting-stack"
import { CognitoStack } from "./cognito-stack"

export interface FastAmplifyStackProps extends cdk.StackProps {
  config: AppConfig
}

export class FastMainStack extends cdk.Stack {
  public readonly amplifyHostingStack: AmplifyHostingStack
  public readonly backendStack: BackendStack
  public readonly cognitoStack: CognitoStack

  constructor(scope: Construct, id: string, props: FastAmplifyStackProps) {
    const description =
      "Factory Sensor Monitor — Main Stack (based on FAST v0.4.1, AgentCore removed)"
    super(scope, id, { ...props, description })

    // 1. Amplify hosting (creates the predictable frontend domain)
    this.amplifyHostingStack = new AmplifyHostingStack(this, `${id}-amplify`, {
      config: props.config,
    })

    // 2. Cognito (needs Amplify URL for callback allowlist)
    this.cognitoStack = new CognitoStack(this, `${id}-cognito`, {
      config: props.config,
      callbackUrls: ["http://localhost:3000", this.amplifyHostingStack.amplifyUrl],
    })

    // 3. Backend (needs Cognito IDs + Amplify URL for CORS)
    this.backendStack = new BackendStack(this, `${id}-backend`, {
      config: props.config,
      userPoolId: this.cognitoStack.userPoolId,
      userPoolClientId: this.cognitoStack.userPoolClientId,
      userPoolDomain: this.cognitoStack.userPoolDomain,
      frontendUrl: this.amplifyHostingStack.amplifyUrl,
    })

    // ── Outputs ───────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyHostingStack.amplifyApp.appId,
      description: "Amplify App ID — use for manual frontend deployment",
      exportName: `${props.config.stack_name_base}-AmplifyAppId`,
    })

    new cdk.CfnOutput(this, "AmplifyUrl", {
      value: this.amplifyHostingStack.amplifyUrl,
      description: "Amplify frontend URL (live after first deploy)",
    })

    new cdk.CfnOutput(this, "AmplifyConsoleUrl", {
      value: `https://console.aws.amazon.com/amplify/apps/${this.amplifyHostingStack.amplifyApp.appId}`,
      description: "Amplify console URL for monitoring deployments",
    })

    new cdk.CfnOutput(this, "StagingBucketName", {
      value: this.amplifyHostingStack.stagingBucket.bucketName,
      description: "S3 bucket for Amplify deployment staging",
      exportName: `${props.config.stack_name_base}-StagingBucket`,
    })

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: this.cognitoStack.userPoolId,
      description: "Cognito User Pool ID",
      exportName: `${props.config.stack_name_base}-CognitoUserPoolId`,
    })

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: this.cognitoStack.userPoolClientId,
      description: "Cognito User Pool Client ID",
      exportName: `${props.config.stack_name_base}-CognitoClientId`,
    })

    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${this.cognitoStack.userPoolDomain.domainName}.auth.${cdk.Aws.REGION}.amazoncognito.com`,
      description: "Cognito OAuth domain",
      exportName: `${props.config.stack_name_base}-CognitoDomain`,
    })

    new cdk.CfnOutput(this, "FeedbackApiUrl", {
      value: this.backendStack.feedbackApiUrl,
      description: "Feedback API Gateway URL (kept from FAST baseline)",
      exportName: `${props.config.stack_name_base}-FeedbackApiUrl`,
    })

    new cdk.CfnOutput(this, "FactoryApiUrl", {
      value: this.backendStack.factoryApiUrl,
      description: "Factory sensor monitoring API URL — set as VITE_API_URL in frontend",
      exportName: `${props.config.stack_name_base}-FactoryApiUrl`,
    })
  }
}

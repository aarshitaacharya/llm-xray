#!/usr/bin/env bash
#
# Builds the image, pushes it to ECR, registers a task definition, and creates
# or updates the Fargate service. Run provision.sh first.
#
# Usage: ./infra/deploy.sh

source "$(dirname "$0")/config.sh"

GENERATED="$(dirname "$0")/.env.generated"
if [[ -f "$GENERATED" ]]; then
  # shellcheck disable=SC1090
  source "$GENERATED"
else
  echo "Missing $GENERATED — run ./infra/provision.sh first." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%s)}"

# ── Build and push ───────────────────────────────────────────────────────────
log "Building $ECR_URI:$IMAGE_TAG"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Fargate runs x86_64; build explicitly so an Apple Silicon host does not push
# an arm64 image that the task cannot start.
docker build --platform linux/amd64 -t "$ECR_URI:$IMAGE_TAG" -t "$ECR_URI:latest" "$ROOT"
docker push "$ECR_URI:$IMAGE_TAG"
docker push "$ECR_URI:latest"
ok "Image pushed"

# ── Task definition ──────────────────────────────────────────────────────────
log "Registering task definition $TASK_FAMILY"
TASK_DEF_JSON="$(cat <<JSON
{
  "family": "$TASK_FAMILY",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "$TASK_CPU",
  "memory": "$TASK_MEMORY",
  "executionRoleArn": "arn:aws:iam::$AWS_ACCOUNT_ID:role/$EXEC_ROLE_NAME",
  "taskRoleArn": "arn:aws:iam::$AWS_ACCOUNT_ID:role/$TASK_ROLE_NAME",
  "runtimePlatform": { "cpuArchitecture": "X86_64", "operatingSystemFamily": "LINUX" },
  "containerDefinitions": [
    {
      "name": "$APP_NAME",
      "image": "$ECR_URI:$IMAGE_TAG",
      "essential": true,
      "portMappings": [
        { "containerPort": $CONTAINER_PORT, "protocol": "tcp" }
      ],
      "environment": [
        { "name": "AWS_REGION", "value": "$AWS_REGION" },
        { "name": "SNS_TOPIC_ARN", "value": "$SNS_TOPIC_ARN" },
        { "name": "PORT", "value": "$CONTAINER_PORT" },
        { "name": "ALLOWED_ORIGINS", "value": "*" }
      ],
      "secrets": [
        {
          "name": "GEMINI_API_KEY",
          "valueFrom": "arn:aws:ssm:$AWS_REGION:$AWS_ACCOUNT_ID:parameter$SSM_PARAM_NAME"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "python -c \"import urllib.request;urllib.request.urlopen('http://127.0.0.1:$CONTAINER_PORT/healthz').read()\" || exit 1"],
        "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 30
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "$LOG_GROUP",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
JSON
)"

TASK_DEF_ARN="$(aws ecs register-task-definition \
  --cli-input-json "$TASK_DEF_JSON" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
ok "Registered $TASK_DEF_ARN"

# ── Service ──────────────────────────────────────────────────────────────────
NETWORK_CONFIG="awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SG_ID],assignPublicIp=ENABLED}"

SERVICE_STATUS="$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --region "$AWS_REGION" \
  --query 'services[0].status' --output text 2>/dev/null || echo NONE)"

if [[ "$SERVICE_STATUS" == "ACTIVE" ]]; then
  log "Updating existing service $SERVICE_NAME"
  aws ecs update-service \
    --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --desired-count "$DESIRED_COUNT" \
    --region "$AWS_REGION" >/dev/null
else
  log "Creating service $SERVICE_NAME"
  aws ecs create-service \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --desired-count "$DESIRED_COUNT" \
    --launch-type FARGATE \
    --network-configuration "$NETWORK_CONFIG" \
    --region "$AWS_REGION" >/dev/null
fi
ok "Service $SERVICE_NAME -> $DESIRED_COUNT task(s)"

log "Waiting for the service to stabilise (this usually takes 1-3 minutes)..."
aws ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" --region "$AWS_REGION"

TASK_ARN="$(aws ecs list-tasks --cluster "$CLUSTER_NAME" --service-name "$SERVICE_NAME" \
  --region "$AWS_REGION" --query 'taskArns[0]' --output text)"
ENI_ID="$(aws ecs describe-tasks --cluster "$CLUSTER_NAME" --tasks "$TASK_ARN" --region "$AWS_REGION" \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" --output text)"
PUBLIC_IP="$(aws ec2 describe-network-interfaces --network-interface-ids "$ENI_ID" --region "$AWS_REGION" \
  --query 'NetworkInterfaces[0].Association.PublicIp' --output text)"

echo
ok "LLM X-Ray is live: http://$PUBLIC_IP:$CONTAINER_PORT"
echo "   health:  http://$PUBLIC_IP:$CONTAINER_PORT/healthz"
echo "   logs:    aws logs tail $LOG_GROUP --follow --region $AWS_REGION"

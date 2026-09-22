#!/usr/bin/env bash
#
# Creates the AWS resources LLM X-Ray needs: ECR repo, SNS topic, log group,
# IAM roles, the SSM parameter holding the Gemini key, and the ECS cluster.
#
# Idempotent — safe to re-run. Does not build or deploy; see deploy.sh.
#
# Usage:
#   GEMINI_API_KEY=... ALERT_EMAIL=you@example.com ./infra/provision.sh

source "$(dirname "$0")/config.sh"

log "Account $AWS_ACCOUNT_ID, region $AWS_REGION"

# ── ECR ──────────────────────────────────────────────────────────────────────
if aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1; then
  ok "ECR repository $ECR_REPO exists"
else
  log "Creating ECR repository $ECR_REPO"
  aws ecr create-repository \
    --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=true \
    --region "$AWS_REGION" >/dev/null
  ok "ECR repository created"
fi

# Keep only the 5 most recent images so old layers do not accrue storage cost.
aws ecr put-lifecycle-policy \
  --repository-name "$ECR_REPO" \
  --region "$AWS_REGION" \
  --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep last 5","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}' >/dev/null
ok "ECR lifecycle policy applied"

# ── SNS ──────────────────────────────────────────────────────────────────────
TOPIC_ARN="$(aws sns create-topic --name "$SNS_TOPIC_NAME" --region "$AWS_REGION" --query TopicArn --output text)"
ok "SNS topic $TOPIC_ARN"

if [[ -n "${ALERT_EMAIL:-}" ]]; then
  EXISTING="$(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --region "$AWS_REGION" \
    --query "Subscriptions[?Endpoint=='$ALERT_EMAIL'].SubscriptionArn" --output text)"
  if [[ -z "$EXISTING" ]]; then
    aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$ALERT_EMAIL" \
      --region "$AWS_REGION" >/dev/null
    warn "Confirmation email sent to $ALERT_EMAIL — click the link or alerts will not arrive"
  else
    ok "Email subscription for $ALERT_EMAIL already present"
  fi
else
  warn "ALERT_EMAIL not set — no subscriber, so published alerts go nowhere"
fi

# ── Gemini API key in SSM Parameter Store ────────────────────────────────────
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  aws ssm put-parameter \
    --name "$SSM_PARAM_NAME" \
    --value "$GEMINI_API_KEY" \
    --type SecureString \
    --overwrite \
    --region "$AWS_REGION" >/dev/null
  ok "Stored Gemini API key at $SSM_PARAM_NAME"
elif aws ssm get-parameter --name "$SSM_PARAM_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  ok "SSM parameter $SSM_PARAM_NAME already set"
else
  warn "GEMINI_API_KEY not set and $SSM_PARAM_NAME does not exist — the task will fail to start"
fi

# ── CloudWatch Logs ──────────────────────────────────────────────────────────
aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "$LOG_GROUP" --retention-in-days 7 --region "$AWS_REGION" >/dev/null
ok "Log group $LOG_GROUP (7-day retention)"

# ── IAM roles ────────────────────────────────────────────────────────────────
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

create_role_if_missing() {
  local role="$1"
  if aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    ok "IAM role $role exists"
  else
    log "Creating IAM role $role"
    aws iam create-role --role-name "$role" --assume-role-policy-document "$TRUST" >/dev/null
    ok "IAM role $role created"
  fi
}

create_role_if_missing "$EXEC_ROLE_NAME"
aws iam attach-role-policy --role-name "$EXEC_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# The execution role pulls the Gemini key out of SSM before the container starts.
aws iam put-role-policy --role-name "$EXEC_ROLE_NAME" --policy-name read-gemini-key \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"ssm:GetParameters\"],\"Resource\":\"arn:aws:ssm:$AWS_REGION:$AWS_ACCOUNT_ID:parameter${SSM_PARAM_NAME}\"}]}"
ok "Execution role policies attached"

create_role_if_missing "$TASK_ROLE_NAME"
# The task role is what the running app uses — it only needs to publish alerts.
aws iam put-role-policy --role-name "$TASK_ROLE_NAME" --policy-name publish-context-alerts \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"sns:Publish\"],\"Resource\":\"$TOPIC_ARN\"}]}"
ok "Task role scoped to sns:Publish on the alerts topic"

# ── ECS cluster ──────────────────────────────────────────────────────────────
aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$AWS_REGION" >/dev/null
ok "ECS cluster $CLUSTER_NAME"

# ── Networking: default VPC + a security group for the container port ───────
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --region "$AWS_REGION" --query 'Vpcs[0].VpcId' --output text)"
if [[ "$VPC_ID" == "None" || -z "$VPC_ID" ]]; then
  echo "No default VPC in $AWS_REGION. Set VPC_ID/SUBNET_IDS manually and re-run." >&2
  exit 1
fi

SG_ID="$(aws ec2 describe-security-groups --region "$AWS_REGION" \
  --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"

if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
  log "Creating security group $SG_NAME"
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" \
    --description "LLM X-Ray container port" --vpc-id "$VPC_ID" \
    --region "$AWS_REGION" --query GroupId --output text)"
fi

aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port "$CONTAINER_PORT" --cidr 0.0.0.0/0 \
  --region "$AWS_REGION" >/dev/null 2>&1 || true
ok "Security group $SG_ID open on tcp/$CONTAINER_PORT"

SUBNET_IDS="$(aws ec2 describe-subnets --region "$AWS_REGION" \
  --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
ok "Subnets $SUBNET_IDS"

cat > "$(dirname "$0")/.env.generated" <<ENVEOF
# Written by provision.sh — consumed by deploy.sh. Not secret.
export SNS_TOPIC_ARN="$TOPIC_ARN"
export VPC_ID="$VPC_ID"
export SG_ID="$SG_ID"
export SUBNET_IDS="$SUBNET_IDS"
ENVEOF

log "Provisioning complete. Next: ./infra/deploy.sh"

#!/usr/bin/env bash
#
# Deletes everything provision.sh and deploy.sh created, so the deployment stops
# costing money. Fargate bills per running task-second.
#
# Usage: ./infra/teardown.sh [--all]
#   (no flag)  scale the service to zero and delete it — stops all charges
#   --all      additionally delete the cluster, ECR repo, SNS topic, roles and logs

source "$(dirname "$0")/config.sh"

log "Deleting service $SERVICE_NAME"
aws ecs update-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" \
  --desired-count 0 --region "$AWS_REGION" >/dev/null 2>&1 || true
aws ecs delete-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" \
  --force --region "$AWS_REGION" >/dev/null 2>&1 || true
ok "Service deleted — Fargate charges stopped"

if [[ "${1:-}" != "--all" ]]; then
  log "Cluster, ECR repo and SNS topic kept. Re-run with --all to remove them."
  exit 0
fi

aws ecs delete-cluster --cluster "$CLUSTER_NAME" --region "$AWS_REGION" >/dev/null 2>&1 || true
ok "Cluster deleted"

aws ecr delete-repository --repository-name "$ECR_REPO" --force --region "$AWS_REGION" >/dev/null 2>&1 || true
ok "ECR repository deleted"

TOPIC_ARN="arn:aws:sns:$AWS_REGION:$AWS_ACCOUNT_ID:$SNS_TOPIC_NAME"
aws sns delete-topic --topic-arn "$TOPIC_ARN" --region "$AWS_REGION" >/dev/null 2>&1 || true
ok "SNS topic deleted"

aws logs delete-log-group --log-group-name "$LOG_GROUP" --region "$AWS_REGION" >/dev/null 2>&1 || true
ok "Log group deleted"

aws ssm delete-parameter --name "$SSM_PARAM_NAME" --region "$AWS_REGION" >/dev/null 2>&1 || true
ok "SSM parameter deleted"

aws iam delete-role-policy --role-name "$EXEC_ROLE_NAME" --policy-name read-gemini-key 2>/dev/null || true
aws iam detach-role-policy --role-name "$EXEC_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy 2>/dev/null || true
aws iam delete-role --role-name "$EXEC_ROLE_NAME" 2>/dev/null || true
aws iam delete-role-policy --role-name "$TASK_ROLE_NAME" --policy-name publish-context-alerts 2>/dev/null || true
aws iam delete-role --role-name "$TASK_ROLE_NAME" 2>/dev/null || true
ok "IAM roles deleted"

SG_ID="$(aws ec2 describe-security-groups --region "$AWS_REGION" \
  --filters Name=group-name,Values="$SG_NAME" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"
if [[ -n "$SG_ID" && "$SG_ID" != "None" ]]; then
  aws ec2 delete-security-group --group-id "$SG_ID" --region "$AWS_REGION" >/dev/null 2>&1 || true
  ok "Security group $SG_ID deleted"
fi

rm -f "$(dirname "$0")/.env.generated"
log "Teardown complete"

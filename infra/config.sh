# Shared settings for the deploy scripts. Override any of these in the environment.
set -euo pipefail

export AWS_REGION="${AWS_REGION:-us-east-1}"
export APP_NAME="${APP_NAME:-llm-xray}"

export ECR_REPO="${ECR_REPO:-$APP_NAME}"
export CLUSTER_NAME="${CLUSTER_NAME:-$APP_NAME-cluster}"
export SERVICE_NAME="${SERVICE_NAME:-$APP_NAME-service}"
export TASK_FAMILY="${TASK_FAMILY:-$APP_NAME-task}"
export LOG_GROUP="${LOG_GROUP:-/ecs/$APP_NAME}"
export SNS_TOPIC_NAME="${SNS_TOPIC_NAME:-$APP_NAME-context-alerts}"
export SSM_PARAM_NAME="${SSM_PARAM_NAME:-/$APP_NAME/gemini-api-key}"

export EXEC_ROLE_NAME="${EXEC_ROLE_NAME:-$APP_NAME-execution-role}"
export TASK_ROLE_NAME="${TASK_ROLE_NAME:-$APP_NAME-task-role}"
export SG_NAME="${SG_NAME:-$APP_NAME-sg}"

# Fargate sizing. 0.5 vCPU / 1GB is enough: the container is I/O bound on the
# Gemini API, and the only real CPU work is a 16x768 PCA.
export TASK_CPU="${TASK_CPU:-512}"
export TASK_MEMORY="${TASK_MEMORY:-1024}"
export CONTAINER_PORT="${CONTAINER_PORT:-8000}"
export DESIRED_COUNT="${DESIRED_COUNT:-1}"

AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export AWS_ACCOUNT_ID
export ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO"

log()  { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[0;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m  !!\033[0m %s\n' "$*"; }

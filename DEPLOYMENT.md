# AWS CodeBuild / CodeDeploy Deployment

Minimal AWS deployment using ECS Fargate (0.25 vCPU, 512 MB memory).

## Files

| File | Purpose |
|------|---------|
| `appspec.yml` | CodeDeploy ECS blue/green spec; `<<TASK_DEFINITION>>` is set by CodePipeline |
| `buildspec.yml` | CodeBuild: builds Docker image from Dockerfile and pushes to ECR |
| `ecs/task-definition.json` | ECS task template; `<<IMAGE1_NAME>>` is replaced with built image URI |

## Pipeline Setup

1. **CodeBuild** (Source: your Git repo)
   - Add env var: `ECR_REPOSITORY_NAME` (e.g. `healplace-backend`)
   - Output: `imagedefinitions.json`

2. **CodeDeploy** (ECS Blue/Green)
   - Task definition: `ecs/task-definition.json` (from source)
   - AppSpec: `appspec.yml` (from source)
   - Image: build output artifact; placeholder `IMAGE1_NAME` in task def

3. **Before first deploy**, set placeholders in `ecs/task-definition.json`:
   - `<EXECUTION_ROLE_ARN>` → e.g. `arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole`
   - `<AWS_REGION>` → e.g. `us-east-1`

4. **Required AWS resources** (minimal):
   - ECR repository
   - ECS cluster (Fargate, networking only)
   - ECS service with CodeDeploy controller
   - Application Load Balancer + 2 target groups
   - CodeDeploy application + deployment group

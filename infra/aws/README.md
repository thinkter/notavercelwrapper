# AWS Warm Workers

This Terraform stack creates:

- 1 VPC
- 1 public subnet
- 1 internet gateway
- 1 security group
- 1 IAM role + instance profile for SSM access
- 2 always-on EC2 workers by default

If you set `worker_api_url` and `worker_repo_url`, the EC2 instances will also:

- clone your repo
- build the `apps/worker` Docker image
- start the worker container as a `systemd` service

For this monorepo, use the public HTTPS GitHub URL instead of the SSH remote unless you are also setting up deploy keys:

```hcl
worker_api_url               = "http://YOUR_API_PUBLIC_HOST:3001"
worker_repo_url              = "https://github.com/thinkter/notavercelwrapper.git"
worker_repo_ref              = "test"
worker_public_http_cidr_blocks = ["0.0.0.0/0"]
```

`worker_api_url` must point to wherever your Bun API is actually reachable from the EC2 workers. Terraform cannot discover this automatically right now because this stack does not provision the API service itself, only the worker hosts.

## Auth

Terraform uses normal AWS credentials. The fastest path is to export them in your shell:

```bash
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export AWS_DEFAULT_REGION="us-east-1"
```

If you also have a session token:

```bash
export AWS_SESSION_TOKEN="your-session-token"
```

## Deploy

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

If your IAM user is restricted, keep `worker_ami_id` set explicitly in `terraform.tfvars`. The default value is an Amazon Linux 2023 AMI for `us-east-1`, but you should replace it if you change regions.

## Notes

- No inbound ports are opened by default.
- Use AWS Systems Manager Session Manager to access the workers instead of SSH.
- If you want to expose your app on a worker later, add CIDRs and ports in `terraform.tfvars`.
- The worker auto-bootstrap expects the repo URL to be reachable from EC2. Public Git repositories are the easiest path for the hackathon.
- If your API is only running on your laptop, the EC2 workers cannot reach `localhost`. Put the API on a public host or a reachable VM first, then use that host in `worker_api_url`.

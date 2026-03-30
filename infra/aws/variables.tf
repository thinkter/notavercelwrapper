variable "project_name" {
  description = "Short name used for AWS resource tags."
  type        = string
  default     = "clircel"
}

variable "environment" {
  description = "Environment label for tags."
  type        = string
  default     = "hackathon"
}

variable "aws_region" {
  description = "AWS region where the worker VMs will be created."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "Single AZ used for the public subnet."
  type        = string
  default     = "us-east-1a"
}

variable "worker_count" {
  description = "How many always-on workers to create."
  type        = number
  default     = 2
}

variable "worker_instance_type" {
  description = "EC2 instance type for warm workers."
  type        = string
  default     = "t3.small"
}

variable "worker_ami_id" {
  description = "AMI ID for the worker instances. Set this explicitly to avoid DescribeImages permission requirements."
  type        = string
  default     = "ami-0953476d60561c955"
}

variable "worker_volume_size_gb" {
  description = "Root volume size for each worker."
  type        = number
  default     = 20
}

variable "worker_api_url" {
  description = "Public base URL for the API that workers should connect to. Leave empty to skip worker service bootstrap."
  type        = string
  default     = ""
}

variable "worker_repo_url" {
  description = "Git repository URL the EC2 worker should clone to run apps/worker. Leave empty to skip worker service bootstrap."
  type        = string
  default     = ""
}

variable "worker_repo_ref" {
  description = "Git branch, tag, or commit to checkout for the worker code."
  type        = string
  default     = "main"
}

variable "worker_allowed_cidr_blocks" {
  description = "Optional inbound CIDR blocks. Leave empty to avoid opening ports."
  type        = list(string)
  default     = []
}

variable "worker_ingress_ports" {
  description = "Optional inbound ports to open for the workers."
  type        = list(number)
  default     = []
}

variable "worker_public_http_cidr_blocks" {
  description = "CIDR blocks allowed to access the worker reverse proxy on port 80."
  type        = list(string)
  default     = []
}

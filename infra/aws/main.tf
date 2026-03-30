locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-igw"
  })
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-subnet"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "workers" {
  name        = "${local.name_prefix}-workers-sg"
  description = "Warm worker security group"
  vpc_id      = aws_vpc.main.id

  dynamic "ingress" {
    for_each = length(var.worker_allowed_cidr_blocks) == 0 ? [] : var.worker_ingress_ports

    content {
      description = "Optional worker ingress"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = var.worker_allowed_cidr_blocks
    }
  }

  dynamic "ingress" {
    for_each = length(var.worker_public_http_cidr_blocks) == 0 ? [] : [80]

    content {
      description = "Public HTTP ingress for deployment proxy"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = var.worker_public_http_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-workers-sg"
  })
}

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "workers" {
  name               = "${local.name_prefix}-workers-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.workers.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "workers" {
  name = "${local.name_prefix}-workers-profile"
  role = aws_iam_role.workers.name
}

resource "aws_instance" "workers" {
  count                       = var.worker_count
  ami                         = var.worker_ami_id
  instance_type               = var.worker_instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.workers.id]
  iam_instance_profile        = aws_iam_instance_profile.workers.name
  associate_public_ip_address = true
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    project_name    = var.project_name
    environment     = var.environment
    worker_api_url  = var.worker_api_url
    worker_repo_url = var.worker_repo_url
    worker_repo_ref = var.worker_repo_ref
  })

  root_block_device {
    volume_size           = var.worker_volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-worker-${count.index + 1}"
    Role = "warm-worker"
  })
}

resource "aws_eip" "workers" {
  count  = var.worker_count
  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-worker-eip-${count.index + 1}"
  })
}

resource "aws_eip_association" "workers" {
  count         = var.worker_count
  instance_id   = aws_instance.workers[count.index].id
  allocation_id = aws_eip.workers[count.index].id
}

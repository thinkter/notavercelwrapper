output "worker_instance_ids" {
  description = "EC2 instance IDs for the warm workers."
  value       = aws_instance.workers[*].id
}

output "worker_public_ips" {
  description = "Public IP addresses of the warm workers."
  value       = aws_eip.workers[*].public_ip
}

output "worker_private_ips" {
  description = "Private IP addresses of the warm workers."
  value       = aws_instance.workers[*].private_ip
}

output "ssm_connection_hint" {
  description = "Reminder that Session Manager is available when your AWS user has SSM permissions."
  value       = "Use AWS Systems Manager Session Manager to connect instead of SSH."
}

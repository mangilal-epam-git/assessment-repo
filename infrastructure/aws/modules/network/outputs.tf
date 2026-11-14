output "vpc_id" {
  description = "VPC identifier."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR block."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet identifiers, used by the load balancer."
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet identifiers, used by the Fargate tasks."
  value       = aws_subnet.private[*].id
}

output "availability_zones" {
  description = "Availability zones in use."
  value       = var.availability_zones
}

output "nat_public_ips" {
  description = "Stable egress addresses, which data providers can allow-list."
  value       = aws_eip.nat[*].public_ip
}

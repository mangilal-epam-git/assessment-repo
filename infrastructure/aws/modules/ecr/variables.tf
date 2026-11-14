variable "repository_name" {
  description = "Name of the ECR repository."
  type        = string
}

variable "immutable_tags" {
  description = "Reject pushes that would move an existing tag to a new digest."
  type        = bool
  default     = true
}

variable "retained_release_images" {
  description = "Number of tagged release images to retain."
  type        = number
  default     = 20
}

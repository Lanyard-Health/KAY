#!/bin/bash

# Wait for LocalStack to be ready
sleep 5

# Create S3 bucket for documents
awslocal s3 mb s3://credentials-documents

# Create S3 bucket for backups
awslocal s3 mb s3://credentials-backups

# Configure CORS for documents bucket
awslocal s3api put-bucket-cors --bucket credentials-documents --cors-configuration '{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedOrigins": ["http://localhost:5190", "http://localhost:5173", "*"],
      "ExposeHeaders": ["ETag"]
    }
  ]
}'

# Verify SES email (in LocalStack, all emails are verified by default)
awslocal ses verify-email-identity --email-address noreply@credentials.local

echo "LocalStack initialization complete!"

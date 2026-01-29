# Healthcare Credentialing Management System

A web-based application for managing healthcare provider credentials, specifically designed for behavioral health and mental health providers.

## Features

- **Provider Management**: Store and manage provider information including NPI, licenses, certifications, education, and work history
- **Document Management**: Upload, store, and track documents with automatic OCR extraction using AWS Textract
- **Expiration Tracking**: Automated monitoring and email notifications for expiring credentials
- **CAQH ProView Integration**: API integration for roster management and data synchronization
- **Copy-Paste Data Views**: Formatted data export for easy form completion
- **SOC 2 Compliance**: Full audit logging, encryption, and access controls

## Tech Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript + Prisma
- **Database**: PostgreSQL (AWS RDS)
- **Auth**: AWS Cognito with MFA
- **Storage**: AWS S3 with KMS encryption
- **OCR**: AWS Textract
- **Infrastructure**: Terraform

## Prerequisites

- Node.js 20+
- Docker and Docker Compose
- AWS CLI (for deployment)
- Terraform 1.5+ (for infrastructure)

## Getting Started

### 1. Clone and Install

```bash
cd C:\projects\KAY
npm install
```

### 2. Start Local Services

```bash
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- LocalStack (S3, SES) on port 4566
- Redis on port 6379

### 3. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Initialize Database

```bash
cd packages/backend
npx prisma migrate dev
npx prisma generate
```

### 5. Start Development Servers

```bash
# From root directory
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- API Health: http://localhost:3001/health

## Project Structure

```
KAY/
├── packages/
│   ├── frontend/        # React application
│   ├── backend/         # Node.js API server
│   └── shared/          # Shared types and validation
├── infrastructure/
│   └── terraform/       # AWS infrastructure as code
├── docker-compose.yml   # Local development services
└── turbo.json          # Monorepo configuration
```

## User Roles

| Role | Permissions |
|------|-------------|
| Admin | Full access including user management and audit logs |
| Credentialing Staff | Manage all providers and documents |
| Provider | View/edit own profile and documents |

## API Endpoints

- `POST /api/v1/auth/login` - Authentication
- `GET /api/v1/providers` - List providers
- `POST /api/v1/providers` - Create provider
- `GET /api/v1/providers/:id` - Get provider details
- `GET /api/v1/documents/upload-url` - Get pre-signed upload URL
- `GET /api/v1/expirations` - Get upcoming expirations
- `POST /api/v1/caqh/pull/:providerId` - Pull CAQH data

## Deployment

### Infrastructure Setup

```bash
cd infrastructure/terraform/environments/dev
terraform init
terraform plan
terraform apply
```

### Application Deployment

The application is designed to run on AWS ECS Fargate. CI/CD can be configured using GitHub Actions.

## Environment Variables

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| COGNITO_USER_POOL_ID | AWS Cognito User Pool ID |
| COGNITO_CLIENT_ID | AWS Cognito Client ID |
| S3_BUCKET_NAME | S3 bucket for documents |
| CAQH_ORG_ID | CAQH Organization ID |
| CAQH_API_KEY | CAQH API Key |

## License

Proprietary - All rights reserved

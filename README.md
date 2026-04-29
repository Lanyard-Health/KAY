# Healthcare Credentialing Management System

**Property of Lanyard Health**

A web-based credentialing repository for behavioral health and mental health providers. This platform stores provider information and enables easy form completion for CAQH ProView and insurance payer applications.

---

## Quick Start (Development)

### Prerequisites

Before you begin, make sure you have installed:

1. **Node.js 22.11.0** (pinned via `.nvmrc`) - Download from https://nodejs.org/. See [Local Development](#local-development) for version-manager details.
2. **Docker Desktop** - Download from https://www.docker.com/products/docker-desktop/
3. **Git** - Download from https://git-scm.com/

### Step 1: Clone the Repository

```bash
git clone https://github.com/Revella-Health/KAY.git
cd KAY
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Start the Database

```bash
docker-compose up -d
```

This starts PostgreSQL on port 5433 (mapped from container's 5432).

### Step 4: Configure Environment

Create environment files:

**Backend** (`packages/backend/.env`):
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/credentials?schema=public"
PORT=3002
NODE_ENV=development
DEV_AUTH_BYPASS=true
JWT_SECRET=your-secret-key-change-in-production
```

**Frontend** (`packages/frontend/.env`):
```env
VITE_DEV_AUTH_BYPASS=true
# VITE_API_URL is NOT needed in dev — the Vite proxy handles /api → localhost:3002
```

### Step 5: Initialize the Database

```bash
cd packages/backend
npx prisma migrate dev
npx prisma generate
cd ../..
```

### Step 6: Start the Application

Open two terminal windows:

**Terminal 1 - Backend:**
```bash
cd packages/backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd packages/frontend
npm run dev
```

### Step 7: Access the Application

- **Frontend**: http://localhost:5190 (or next available port)
- **Backend API**: http://localhost:3002
- **Health Check**: http://localhost:3002/health

In development mode with `DEV_AUTH_BYPASS=true`, you can log in with any credentials.

---

## Local Development

### Node Version

This repo pins Node to **22.11.0** via `.nvmrc`. Stick to that version locally — newer Node releases (notably 25.x) have a known incompatibility with `tsx` 4.21 that causes `npm run dev` in `packages/backend` to hang for minutes during startup. See [issue #225](https://github.com/Revella-Health/KAY/issues/225) for the full diagnosis.

**With a version manager** (recommended):

- **nvm**: run `nvm use` in the repo root. If `22.11.0` is not installed yet, run `nvm install 22.11.0` first.
- **fnm**: `fnm use` picks up `.nvmrc` automatically.
- **asdf**: install the `nodejs` plugin and run `asdf install nodejs 22.11.0`.

**Without a version manager**: install Node 22.x manually from https://nodejs.org/. Avoid Node 25.x until PR 2 of #225 lands (which will replace `tsx watch` with `tsc -w` + `node --watch dist/index.js` and remove the version sensitivity).

Production deploys on Render are unaffected — they build with `tsc` and run `node dist/index.js`, never going through the `tsx` transpile path.

---

## Features

### Provider Management
- Store provider profiles with NPI, licenses, certifications, education, and work history
- Support for multiple provider types (Psychiatrist, Psychologist, LCSW, LPC, LMFT, PMHNP)

### Practice Locations
- Manage multiple practice locations per provider
- Track address, contact info, office hours, and accessibility options

### Credentialing Checklist
- Interactive checklist for required documents (W9, COI, CP575)
- Status tracking: Not Started → Pending Upload → Pending Review → Approved/Rejected
- Approval workflow for credentialing staff

### Insurance Payer Enrollments
- Track enrollment status with insurance payers
- Status workflow from application to approval
- Notes and provider numbers tracking

### Document Management
- Upload and store credential documents
- Document type classification
- Expiration date tracking
- AWS Textract OCR integration (when configured)

### Data Export
- CSV export for provider data
- PDF credential reports with formatted tables

### Security & Compliance
- Role-based access control (Admin, Credentialing Staff, Provider)
- Audit logging for SOC 2 compliance
- Encryption at rest and in transit (when deployed to AWS)

---

## User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Full access including user management and audit logs |
| **Credentialing Staff** | Manage all providers, documents, and enrollments |
| **Provider** | View/edit own profile and upload documents |

---

## Project Structure

```
KAY/
├── packages/
│   ├── frontend/        # React application (Vite + TypeScript + Tailwind)
│   ├── backend/         # Node.js API server (Express + Prisma)
│   └── shared/          # Shared types and validation schemas
├── infrastructure/
│   └── terraform/       # AWS infrastructure as code
├── docker-compose.yml   # Local development services (PostgreSQL)
├── RELEASE_NOTES.md     # Version history and features
└── README.md            # This file
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| UI Components | Headless UI + Heroicons |
| State Management | TanStack Query + Zustand |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma |
| Database | PostgreSQL |
| Authentication | AWS Cognito (production) / Dev bypass (development) |
| File Storage | AWS S3 (production) |
| OCR | AWS Textract (production) |

---

## Production Deployment (AWS)

### Required AWS Services

1. **RDS PostgreSQL** - Database
2. **Cognito** - Authentication with MFA
3. **S3** - Document storage with KMS encryption
4. **ECS Fargate** - Container hosting
5. **CloudFront** - CDN for frontend
6. **Textract** - OCR for documents
7. **SES** - Email notifications

### Environment Variables (Production)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `COGNITO_USER_POOL_ID` | AWS Cognito User Pool ID |
| `COGNITO_CLIENT_ID` | AWS Cognito Client ID |
| `S3_BUCKET_NAME` | S3 bucket for documents |
| `AWS_REGION` | AWS region (e.g., us-east-1) |
| `JWT_SECRET` | Secret for JWT signing |
| `CAQH_ORG_ID` | CAQH Organization ID (optional) |
| `CAQH_API_KEY` | CAQH API Key (optional) |

### Terraform Deployment

```bash
cd infrastructure/terraform/environments/prod
terraform init
terraform plan
terraform apply
```

---

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User login
- `GET /api/v1/users/me` - Get current user

### Providers
- `GET /api/v1/providers` - List all providers
- `POST /api/v1/providers` - Create provider
- `GET /api/v1/providers/:id` - Get provider details
- `PUT /api/v1/providers/:id` - Update provider

### Practice Locations
- `GET /api/v1/practice-locations/provider/:providerId` - Get locations
- `POST /api/v1/practice-locations/provider/:providerId` - Add location
- `PUT /api/v1/practice-locations/:id` - Update location
- `DELETE /api/v1/practice-locations/:id` - Delete location

### Checklist
- `GET /api/v1/checklist/provider/:providerId` - Get checklist status
- `PUT /api/v1/checklist/provider/:providerId` - Update checklist

### Enrollments
- `GET /api/v1/enrollments/provider/:providerId` - Get enrollments
- `POST /api/v1/enrollments/provider/:providerId` - Add enrollment
- `PUT /api/v1/enrollments/:id` - Update enrollment
- `DELETE /api/v1/enrollments/:id` - Delete enrollment

### Documents
- `GET /api/v1/documents/provider/:providerId` - Get documents
- `GET /api/v1/documents/upload-url` - Get pre-signed upload URL

### Bug Monitor
- Automated error detection pipeline that creates Linear issues from bugs
- Monitors: backend runtime errors, frontend crashes, CI failures, security scan findings
- AI-powered triage (Claude Haiku) with rule-based fallback for severity classification
- PII sanitization (SOC 2 compliant) before any data leaves the system
- **Enable**: Set `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, and `LINEAR_BUG_MONITOR_ENABLED=true` in env vars
- **Disable**: Set `LINEAR_BUG_MONITOR_ENABLED=false` (kill switch)
- Issues are tracked in [Linear](https://linear.app) with deduplication and noise filtering

---

## Troubleshooting

### Database Connection Issues
```bash
# Check if Docker is running
docker ps

# Restart the database
docker-compose down
docker-compose up -d

# Check database logs
docker-compose logs postgres
```

### Port Already in Use
The application will automatically try the next available port. Check the terminal output for the actual port number.

### Reset Database
```bash
cd packages/backend
npx prisma migrate reset
```

---

## Support

For technical support or questions about this platform, contact your development team.

---

## License

**Proprietary Software** - All Rights Reserved

Copyright 2026 Lanyard Health

This software is the exclusive property of Lanyard Health. Unauthorized copying, modification, distribution, or use of this software is strictly prohibited.

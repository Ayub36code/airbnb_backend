# 🏠 RentalPlatform — Enterprise Backend API

> Production-ready Airbnb-style rental platform backend built with NestJS, PostgreSQL, Redis, Elasticsearch, WebSockets, and multi-provider payments (Stripe, PayPal, MTN MoMo).

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                           │
│           Web App │ Mobile App │ Third-party                │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS / WSS
┌─────────────────────────▼───────────────────────────────────┐
│                    NGINX (Reverse Proxy)                     │
│           Rate Limiting │ SSL Termination │ Load Balance     │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│               NestJS API (AWS ECS Fargate)                  │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │   Auth   │ │Properties│ │ Bookings │ │  Payments    │  │
│  │  Module  │ │  Module  │ │  Module  │ │   Module     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Reviews  │ │Messaging │ │  Search  │ │ Notifications│  │
│  │  Module  │ │  Module  │ │  Module  │ │   Module     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Wallet  │ │Disputes  │ │Analytics │ │    Admin     │  │
│  │  Module  │ │  Module  │ │  Module  │ │   Module     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           WebSocket Gateway (Socket.IO)              │  │
│  │    Real-time messaging │ Notifications │ Presence    │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────┬──────────────┬───────────────┬───────────────────┘
           │              │               │
┌──────────▼──┐  ┌────────▼──────┐  ┌────▼──────────────────┐
│ PostgreSQL  │  │     Redis     │  │    Elasticsearch      │
│  (Prisma)   │  │ Cache/Session │  │  Full-text + Geo      │
│ ACID + Pool │  │ Locks/Queues  │  │    Search Engine      │
└─────────────┘  └───────────────┘  └───────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                    Payment Providers                         │
│     Stripe Cards │ PayPal │ MTN MoMo (Africa)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Git

### 1. Clone & Configure
```bash
git clone https://github.com/your-org/rental-platform.git
cd rental-platform
cp .env.example .env
# Edit .env with your credentials
```

### 2. Start Infrastructure
```bash
# Start all services (Postgres, Redis, Elasticsearch)
docker-compose --profile dev up -d postgres redis elasticsearch

# Or start everything including GUI tools
docker-compose --profile dev up -d
```

### 3. Install & Setup
```bash
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
```

### 4. Run API
```bash
# Development (with hot reload)
npm run start:dev

# Production
npm run build && npm run start:prod
```

**API:** http://localhost:3000/api/v1  
**Swagger:** http://localhost:3000/docs

---

## 📁 Project Structure

```
src/
├── main.ts                         # Bootstrap & Swagger setup
├── app.module.ts                   # Root module
│
├── config/                         # Config factories
│   ├── app.config.ts
│   ├── jwt.config.ts
│   ├── redis.config.ts
│   ├── database.config.ts
│   ├── aws.config.ts
│   ├── stripe.config.ts
│   └── logger.config.ts
│
├── common/                         # Shared utilities
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── public.decorator.ts
│   │   └── roles.decorator.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   └── interceptors/
│       ├── transform.interceptor.ts
│       └── logging.interceptor.ts
│
├── redis/                          # Redis client & service
│   ├── redis.module.ts
│   └── redis.service.ts
│
├── websockets/                     # Socket.IO gateway
│   ├── app.gateway.ts
│   └── websockets.module.ts
│
├── queues/                         # BullMQ background jobs
│   ├── queues.module.ts
│   ├── queues.service.ts
│   └── processors/
│       ├── email.processor.ts
│       ├── notification.processor.ts
│       ├── payout.processor.ts
│       └── booking-reminder.processor.ts
│
└── modules/                        # Feature modules
    ├── prisma/                     # Database service
    ├── health/                     # Health checks
    ├── auth/                       # JWT auth, 2FA, sessions
    ├── users/                      # Profile management
    ├── properties/                 # Listings & availability
    ├── bookings/                   # Reservations & lifecycle
    ├── payments/                   # Stripe, PayPal, MoMo
    ├── reviews/                    # Ratings & reviews
    ├── messaging/                  # Conversations & messages
    ├── notifications/              # Email, SMS, in-app
    ├── search/                     # Elasticsearch + recommendations
    ├── analytics/                  # Host & platform analytics
    ├── admin/                      # Admin dashboard & fraud
    ├── wallet/                     # Wallet & payouts
    ├── disputes/                   # Dispute management
    └── files/                      # S3 image upload
```

---

## 🔌 API Endpoints Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register (Guest/Host) |
| POST | `/auth/login` | Login + 2FA support |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout (single/all sessions) |
| GET  | `/auth/verify-email/:token` | Verify email |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset with token |
| POST | `/auth/2fa/setup` | Get 2FA secret & QR |
| POST | `/auth/2fa/enable` | Enable 2FA |

### Properties
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/properties` | Search/list properties |
| POST   | `/properties` | Create listing (Host) |
| GET    | `/properties/:id` | Property details |
| PUT    | `/properties/:id` | Update listing |
| DELETE | `/properties/:id` | Delete listing |
| GET    | `/properties/:id/availability` | Availability calendar |
| POST   | `/properties/:id/block-dates` | Block dates |
| GET    | `/properties/:id/price-calculator` | Calculate price |
| POST   | `/properties/:id/favorite` | Toggle favorite |
| GET    | `/properties/favorites` | My wishlist |
| GET    | `/properties/host/mine` | My listings |
| POST   | `/properties/:id/amenities` | Set amenities |
| PATCH  | `/properties/:id/approve` | Admin: approve |
| PATCH  | `/properties/:id/suspend` | Admin: suspend |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/bookings` | Create booking |
| GET    | `/bookings/my-trips` | Guest trips |
| GET    | `/bookings/host-reservations` | Host reservations |
| GET    | `/bookings/:id` | Booking details |
| PATCH  | `/bookings/:id/confirm` | Host confirms |
| PATCH  | `/bookings/:id/reject` | Host rejects |
| PATCH  | `/bookings/:id/check-in` | Record check-in |
| PATCH  | `/bookings/:id/check-out` | Record check-out |
| PATCH  | `/bookings/:id/cancel` | Cancel booking |
| GET    | `/bookings/:id/invoice` | Get invoice |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/payments/bookings/:id/pay` | Pay for booking |
| POST   | `/payments/webhooks/stripe` | Stripe webhook |
| POST   | `/payments/paypal/capture/:orderId` | Capture PayPal |
| GET    | `/payments/momo/status/:ref` | MoMo status |
| GET    | `/payments/:id` | Payment details |
| GET    | `/payments` | Transaction history |

### Search
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/search/properties` | Full-text search (ES) |
| GET | `/search/nearby` | Geo-distance search |
| GET | `/search/autocomplete` | Autocomplete suggestions |
| GET | `/search/recommendations` | Personalized picks |
| GET | `/search/reindex` | Admin: re-index ES |

### Reviews
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/reviews` | Submit review |
| GET  | `/reviews/properties/:id` | Property reviews |
| GET  | `/reviews/properties/:id/summary` | Rating summary |
| GET  | `/reviews/users/:id` | User reviews |
| POST | `/reviews/:id/respond` | Host responds |

### Messaging
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST  | `/messaging/conversations` | Start conversation |
| GET   | `/messaging/conversations` | List conversations |
| GET   | `/messaging/conversations/:id/messages` | Get messages |
| POST  | `/messaging/conversations/:id/messages` | Send message |
| PATCH | `/messaging/conversations/:id/archive` | Archive |

### Wallet
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/wallet` | Wallet + recent txns |
| GET  | `/wallet/balance` | Balance only |
| GET  | `/wallet/transactions` | Full history |
| POST | `/wallet/withdraw` | Withdraw funds |
| POST | `/wallet/payout-accounts` | Add payout account |
| GET  | `/wallet/payout-accounts` | List payout accounts |

### Disputes
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST  | `/disputes` | Open dispute |
| GET   | `/disputes` | My disputes |
| GET   | `/disputes/:id` | Dispute details |
| POST  | `/disputes/:id/messages` | Add message |
| PATCH | `/disputes/:id/resolve` | Admin: resolve |
| PATCH | `/disputes/:id/escalate` | Admin: escalate |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/dashboard` | Platform stats |
| GET | `/admin/analytics/revenue` | Revenue charts |
| GET | `/admin/users` | List all users |
| PATCH | `/admin/users/:id/suspend` | Suspend user |
| PATCH | `/admin/users/:id/activate` | Activate user |
| GET | `/admin/audit-logs` | Audit trail |
| GET | `/admin/fraud-alerts` | Fraud alerts |
| GET | `/admin/config` | System config |
| POST | `/admin/config` | Update config |

---

## 🔐 Security

- **JWT Auth**: Access token (15m) + Refresh token (7d) rotation
- **2FA**: TOTP via Authenticator apps (speakeasy)
- **Rate Limiting**: Per-endpoint throttling (NestJS Throttler + Redis)
- **Account Locking**: 5 failed logins → 30-min lockout
- **RBAC**: Admin / Host / Guest role enforcement on every route
- **Helmet**: HTTP security headers
- **CORS**: Configured whitelist
- **Password Hashing**: bcrypt (12 rounds)
- **SQL Injection**: Prisma parameterized queries
- **Distributed Locks**: Redis `SET NX EX` for race condition prevention
- **Fraud Detection**: Risk scoring on bookings and payments

---

## 💳 Payment Flows

### Stripe Card
1. `POST /payments/bookings/:id/pay` → returns `clientSecret`
2. Frontend confirms with Stripe.js
3. Stripe calls webhook → booking confirmed, host payout queued

### PayPal
1. `POST /payments/bookings/:id/pay` → returns `approvalUrl`
2. User redirected to PayPal
3. On return: `POST /payments/paypal/capture/:orderId`

### MTN MoMo (Africa)
1. `POST /payments/bookings/:id/pay` with `momoPhone`
2. USSD prompt sent to phone
3. Poll: `GET /payments/momo/status/:referenceId`

---

## 🌍 Multi-currency & Localization
- Supported currencies: USD, EUR, GBP, UGX, KES, NGN, ZAR, GHS
- User `preferredCurrency` stored in profile
- MoMo supports: UGX, KES, GHS, XOF, ZMW, RWF
- `preferredLanguage` field for i18n readiness

---

## ⚡ WebSocket Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `join-conversation` | `{ conversationId }` | Join a chat room |
| `send-message` | `{ conversationId, content, type }` | Send message |
| `typing` | `{ conversationId, isTyping }` | Typing indicator |
| `mark-read` | `{ conversationId }` | Mark as read |
| `subscribe-booking` | `{ bookingId }` | Subscribe to booking updates |

### Server → Client
| Event | Description |
|-------|-------------|
| `new-message` | New chat message |
| `typing` | Peer is typing |
| `booking-updated` | Booking status changed |
| `notification` | In-app notification |
| `presence:{userId}` | Online/offline status |

---

## 🐳 Docker Deployment

```bash
# Development (with GUI tools)
docker-compose --profile dev up -d

# Production
docker-compose --profile production up -d

# Rebuild API only
docker-compose build api && docker-compose up -d api
```

**Dev Tools:**
- pgAdmin: http://localhost:5050
- Redis Commander: http://localhost:8081
- Kibana: http://localhost:5601
- Swagger: http://localhost:3000/docs

---

## ☁️ AWS Deployment

```bash
# 1. Build & push image
aws ecr get-login-password | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.REGION.amazonaws.com
docker build -t rental-platform .
docker tag rental-platform:latest ACCOUNT.dkr.ecr.REGION.amazonaws.com/rental-platform:latest
docker push ACCOUNT.dkr.ecr.REGION.amazonaws.com/rental-platform:latest

# 2. Run DB migrations
aws ecs run-task --cluster rental-platform-cluster \
  --task-definition rental-platform-api \
  --overrides '{"containerOverrides":[{"name":"rental-api","command":["npx","prisma","migrate","deploy"]}]}'

# 3. Deploy
aws ecs update-service --cluster rental-platform-cluster \
  --service rental-api-service --force-new-deployment
```

---

## 🧪 Demo Credentials

| Role  | Email                        | Password     |
|-------|------------------------------|--------------|
| Admin | admin@rentalplatform.com     | Admin@123456 |
| Host  | host@demo.com                | Host@123456  |
| Guest | guest@demo.com               | Guest@123456 |

---

## 📦 Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 10 + TypeScript |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache / Locks | Redis 7 (ioredis) |
| Search | Elasticsearch 8 |
| Real-time | Socket.IO (WebSockets) |
| Queues | BullMQ (Redis-backed) |
| Auth | JWT + Passport + bcrypt + 2FA |
| Payments | Stripe, PayPal, MTN MoMo |
| File Storage | AWS S3 + CloudFront CDN |
| Image Processing | Sharp |
| Email | Nodemailer + SendGrid |
| SMS | Twilio |
| Logging | Winston |
| Containerization | Docker + Docker Compose |
| Deployment | AWS ECS Fargate + ECR |
| CI/CD | GitHub Actions |
| API Docs | Swagger / OpenAPI |

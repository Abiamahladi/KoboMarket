# KoboMarket

KoboMarket is a multi-vendor e-commerce marketplace built with
Node.js and Express.

The platform allows vendors to register, create stores, list products,
and receive orders from customers.

It includes wallet management, double-entry accounting, payment
processing, and an escrow system to protect buyers and vendors.

## Technology Stack

| Component | Technology |
|---|---|
| Backend | Node.js |
| API Framework | Express.js |
| Document Database | MongoDB |
| Financial Database | PostgreSQL |
| Query Builder | Knex.js |
| Cache | Redis |
| Background Jobs | BullMQ |
| Payment Gateway | Paystack |
| Containerization | Docker |
| API Documentation | Swagger |
| Logging | Pino |
| Testing | Jest and Supertest |

## Architecture

KoboMarket uses three data services:

### MongoDB
Stores marketplace information:
- User accounts
- Vendor profiles
- Stores
- Products
- Shopping carts
- Reviews
- Notifications

### PostgreSQL
Stores financial and transactional information:
- Wallets
- Double-entry ledger
- Orders
- Escrow transactions
- Disputes
- Refunds
- Vendor payouts

### Redis
Provides:
- Application caching
- Background job infrastructure
- Temporary data storage

PostgreSQL is the financial source of truth.

All financial amounts are stored as integer kobo to avoid
floating-point calculation errors.

## Project Structure

```text
kobomarket/
├── database/
│   ├── migrations/
│   └── seeds/
├── src/
│   ├── config/
│   ├── docs/
│   ├── events/
│   ├── jobs/
│   ├── middleware/
│   ├── modules/
│   ├── utils/
│   ├── app.js
│   └── server.js
├── tests/
│   ├── concurrency/
│   ├── integration/
│   └── unit/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
└── README.md

Requirements
- Node.js 20 or later
- npm
- Docker Engine
- Docker Compose
Installation
Clone the repository:
git clone <repository-url>
cd kobomarket


Install dependencies:
npm install


Create the environment file:
cp .env.example .env


Update .env with your own credentials and secrets.
Start Infrastructure
Start MongoDB, PostgreSQL and Redis:
sudo docker compose up -d


Check service status:
sudo docker compose ps


Start the Application
Development mode:
npm run dev


Production mode:
npm start


Health Check
With the application running:
curl http://localhost:3000/health


Expected response:
{
  "success": true,
  "message": "KoboMarket API is running"
}


Financial Integrity
The financial system is designed around:
- Double-entry accounting
- Database transactions
- Idempotency
- Row-level locking
- Escrow management
- Transaction reconciliation
- Audit trails
Redis and MongoDB will not be used as the source of truth
for financial balances.
Development Approach
The project is developed in modules, from infrastructure
and database design through authentication, marketplace
features, financial operations, testing and deployment.

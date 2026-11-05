# KoboMarket

KoboMarket is a multi-vendor e-commerce marketplace built with
Node.js and Express.

The platform allows vendors to register, create stores, list products,
and receive orders from customers.

It includes wallet management, double-entry accounting, payment
processing, and an escrow system designed to protect buyers and vendors.

## Technology Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20+ |
| API Framework | Express.js |
| Document Database | MongoDB |
| Financial Database | PostgreSQL |
| Query Builder | Knex.js |
| Cache | Redis |
| Background Jobs | BullMQ |
| Payment Gateway | Paystack |
| Containerization | Docker |
| API Documentation | Swagger / OpenAPI |
| Logging | Pino |
| Testing | Jest and Supertest |
| Version Control | Git |

## System Architecture

KoboMarket uses three data services, each with a specific responsibility.

### MongoDB — Marketplace Data

MongoDB stores general marketplace information:

- User profiles
- Vendor profiles
- Stores
- Products
- Categories
- Shopping carts
- Product reviews
- Notifications

### PostgreSQL — Financial and Transactional Data

PostgreSQL is the financial source of truth.

It stores:

- User identity references
- Wallets and wallet balances
- Double-entry ledger
- Financial accounts
- Orders and order items
- Vendor orders
- Payments
- Escrow transactions
- Disputes
- Refunds
- Vendor payouts
- Outbox events
- Audit logs

Financial records are managed using PostgreSQL transactions and
database integrity constraints.

### Redis — Caching and Background Jobs

Redis provides infrastructure for:

- Application caching
- Temporary data storage
- Background job queues through BullMQ
- Rate limiting and other temporary application data

Redis is not the source of truth for financial balances or transactions.

## Financial Design and Integrity

The financial system is designed around the following principles:

- Double-entry accounting.
- Integer-based monetary values.
- Database transactions.
- Idempotency for financial operations.
- Row-level locking for concurrent operations.
- Immutable posted ledger entries.
- Escrow management.
- Refund and payout tracking.
- Transaction reconciliation.
- Audit trails.
- Outbox-based event processing for operations involving multiple databases.

### Monetary Representation

All monetary amounts are stored as integer kobo using PostgreSQL BIGINT.

For example:

| Amount | Stored Value |
|---|---:|
| ₦100.00 | 10000 |
| ₦1,000.00 | 100000 |
| ₦5,000.00 | 500000 |
| ₦10,000.00 | 1000000 |

This avoids floating-point arithmetic errors in financial calculations.

The initial supported currency is NGN.

### Multi-Vendor Order Design

A customer checkout creates a parent order.

When multiple vendors are involved, the parent order is split into
individual vendor orders.

This allows each vendor order to have independent fulfilment,
escrow, dispute, refund and payout processing.

### Cross-Database Consistency

MongoDB and PostgreSQL do not share a distributed database transaction.

The application will use an Outbox pattern and compensating actions
to coordinate operations that involve both databases.

## Project Structure

```text
kobomarket/
├── database/
│   ├── migrations/
│   └── seeds/
├── src/
│   ├── config/
│   │   ├── env.js
│   │   ├── mongodb.js
│   │   ├── postgres.js
│   │   └── redis.js
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
├── knexfile.js
├── package.json
├── package-lock.json
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


Update .env with your own local database credentials and
application secrets.

Never commit .env or expose application secrets.
Infrastructure Setup
Start MongoDB, PostgreSQL and Redis:
sudo docker compose up -d


Check container status:
sudo docker compose ps


The three services should report a healthy status before starting
the application.
Database Management
Knex.js manages the PostgreSQL schema.

Check the status of database schema files:
npm run db:status


Apply pending schema files:
npm run db:migrate


Roll back the latest batch:
npm run db:rollback


Create a new schema file:
npm run db:make -- create_table_name


Run database seeds:
npm run db:seed


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
  "message": "KoboMarket API is running",
  "timestamp": "2026-11-04T15:22:31.250Z"
}


The current health endpoint confirms that the HTTP application is
running. Dependency-aware readiness checks will be added as the
project develops.
Development Approach
KoboMarket is being developed in 19 modules.
Module	Description	Status
1	Project Setup and Infrastructure	Completed
2	Database Design and Setup	Completed
3	Redis Caching and Infrastructure Integration	Next
4	Authentication and User Accounts	Planned
5	Role-Based Access Control	Planned
6	Vendor and Store Management	Planned
7	Product Catalogue and Reviews	Planned
8	Shopping Cart	Planned
9	Wallets and Double-Entry Ledger	Planned
10	Wallet Funding and Paystack	Planned
11	Checkout and Order Management	Planned
12	Escrow	Planned
13	Disputes and Refunds	Planned
14	Vendor Payouts	Planned
15	Background Jobs and BullMQ	Planned
16	Notifications and Real-Time Events	Planned
17	Admin Dashboard and Reporting	Planned
18	Testing, Security and Financial Auditing	Planned
19	API Documentation, Deployment and Submission	Planned

Module status indicates the development stage, not that every
feature listed in the architecture has already been implemented.
Project Goals
The goal is to build a complete, maintainable and secure
marketplace backend while demonstrating practical skills in:
- Node.js backend engineering
- Database architecture and design
- Financial transaction integrity
- Redis caching
- Asynchronous processing
- API development
- Infrastructure automation
- Containerization
- Testing and security
- Production deployment

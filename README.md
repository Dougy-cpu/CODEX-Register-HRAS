# CODEX-Register-HRAS

**HR Analytics Summit 2026 — Conference Registration & Checkout System**

A full-stack, production-grade event registration platform built for the **HR Analytics Summit 2026** (3 September 2026, 155 Bishopsgate, London). Handles the complete attendee journey from initial pass selection through Stripe card payment or invoice checkout, attendee management, email delivery, and a comprehensive admin back-office.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Monorepo Structure](#2-architecture--monorepo-structure)
3. [Technology Stack](#3-technology-stack)
4. [Workspace Packages](#4-workspace-packages)
5. [Database Schema](#5-database-schema)
6. [API Reference](#6-api-reference)
7. [Frontend Application](#7-frontend-application)
8. [Admin Panel](#8-admin-panel)
9. [Pricing Engine](#9-pricing-engine)
10. [Payment Flows](#10-payment-flows)
11. [Email System](#11-email-system)
12. [Google Sheets Integration](#12-google-sheets-integration)
13. [Calendar / iCal Support](#13-calendar--ical-support)
14. [Environment Variables & Secrets](#14-environment-variables--secrets)
15. [Running the Project](#15-running-the-project)
16. [Development Workflows](#16-development-workflows)
17. [Codegen & Type Safety](#17-codegen--type-safety)
18. [GitHub Sync](#18-github-sync)
19. [Security Notes](#19-security-notes)
20. [Brand & Design Tokens](#20-brand--design-tokens)
21. [Order Reference Format](#21-order-reference-format)
22. [Key Business Rules](#22-key-business-rules)

---

## 1. Project Overview

This system manages the entire registration lifecycle for the HR Analytics Summit:

- **Public checkout** — multi-step form collecting lead/attendee details, pass selection, promo code application, and payment (card or invoice)
- **Self-service management** — token-gated attendee management and billing edit pages (no login required)
- **Admin back-office** — full registrations dashboard, promo code CRUD, discount tier management, pass configuration, email template editor, audit log, and invoice tooling
- **Automated communications** — confirmation emails with PDF VAT receipt, welcome emails per attendee, organiser notification emails, and invoice reminder emails
- **Stripe integration** — Checkout Sessions for card payments, Stripe Invoicing for invoice/bank-transfer payments, webhook-driven status updates
- **Google Sheets sync** — one-row-per-attendee live export to a Google Sheet for operational use

---

## 2. Architecture & Monorepo Structure

This is a **pnpm workspace monorepo**. All packages share a single `node_modules` at the root and use TypeScript composite project references for fast incremental builds.

```
workspace/
├── artifacts/
│   ├── api-server/          # Express 5 REST API (port 8080 in dev, $PORT in prod)
│   └── checkout/            # React + Vite frontend (port from $PORT)
├── lib/
│   ├── api-spec/            # Single source of truth: openapi.yaml + Orval codegen config
│   ├── api-client-react/    # Generated React Query hooks (never edit by hand)
│   ├── api-zod/             # Generated Zod v4 schemas from OpenAPI spec
│   └── db/                  # Drizzle ORM schema, migrations, and DB connection
├── scripts/
│   ├── sync-to-github.sh    # Pushes workspace to CODEX-Register-HRAS on GitHub
│   └── post-merge.sh        # Post-merge setup (runs after task-agent merges)
├── pnpm-workspace.yaml
├── tsconfig.base.json       # Shared TypeScript compiler options
├── tsconfig.json            # Root project references
├── eslint.config.mjs
├── vitest.config.ts
└── package.json
```

### Key Design Decisions

- **OpenAPI-first**: The API contract lives in `lib/api-spec/openapi.yaml`. Frontend hooks and Zod schemas are generated from it — never hand-written.
- **Integer-pence arithmetic**: All monetary calculations internally use integer pence (× 100) to eliminate floating-point drift. Pounds appear only at the API boundary.
- **Atomic confirmation**: Booking status flip, promo counter increment, and all side effects (email, Sheets sync) run inside a single DB transaction, preventing split-brain on crash.
- **Per-side-effect delivery flags**: Each post-confirmation action (`confirmationEmailSent`, `welcomeEmailsSent`, `organiserNotified`, `sheetsSynced`) has its own boolean column. Failed deliveries are visible in the admin panel and can be individually retried.

---

## 3. Technology Stack

| Layer             | Technology                             |
| ----------------- | -------------------------------------- |
| **Monorepo**      | pnpm workspaces                        |
| **Language**      | TypeScript 5.9 (strict, composite)     |
| **Node.js**       | 24                                     |
| **API Framework** | Express 5                              |
| **Database**      | PostgreSQL + Drizzle ORM               |
| **Validation**    | Zod v4 (`zod/v4`), `drizzle-zod`       |
| **API Contract**  | OpenAPI 3.1 (Orval codegen)            |
| **Frontend**      | React, Vite, Tailwind CSS, shadcn/ui   |
| **Routing (FE)**  | Wouter                                 |
| **Data Fetching** | TanStack React Query v5                |
| **Payments**      | Stripe (Checkout Sessions + Invoicing) |
| **Email**         | Nodemailer (SMTP) + PDFKit (receipts)  |
| **PDF**           | PDFKit                                 |
| **Google Sheets** | `googleapis` (service account)         |
| **Logging**       | Pino                                   |
| **Build (API)**   | esbuild (CJS bundle)                   |
| **Build (FE)**    | Vite                                   |
| **Testing**       | Vitest                                 |
| **Linting**       | ESLint 10 + typescript-eslint          |
| **Formatting**    | Prettier                               |

---

## 4. Workspace Packages

### `artifacts/api-server`

Express 5 REST API. Handles all business logic, DB access, Stripe calls, email sending, and Sheets sync.

- **Entry**: `src/index.ts`
- **Port**: `8080` in development, `$PORT` in production
- **Routes module**: `src/routes/index.ts` — mounts all sub-routers
- **Lib modules**:
  - `src/lib/pricing.ts` — VAT + group discount + promo code calculation engine
  - `src/lib/invoice.ts` — Stripe invoice create/reissue/void/refresh logic
  - `src/lib/email.ts` — Nodemailer transport + template rendering + PDF attachment
  - `src/lib/pdf.ts` — PDFKit VAT receipt generator (fallback when no Stripe PDF)
  - `src/lib/booking-confirmation.ts` — orchestrates all post-payment side effects
  - `src/lib/google-sheets.ts` — Google Sheets append/upsert for attendee rows
  - `src/lib/audit.ts` — writes to `activity_log` for every admin mutation
  - `src/lib/seed.ts` — idempotent seed: email templates, discount tiers, pass config
  - `src/lib/logger.ts` — Pino logger instance
  - `src/lib/order-reference.ts` — `HRAS26-{6541 + bookingId}` format
  - `src/lib/ics.ts` — RFC-5545 iCalendar file generation
  - `src/lib/schema-check.ts` — startup DB schema validation
  - `src/lib/invoice-status.ts` — stale-cache poll of Stripe invoice status
- **Middleware**:
  - `src/middleware/admin-auth.ts` — HMAC-SHA256 token verification
  - `src/middleware/admin-login-throttle.ts` — rate-limit 5 attempts / 15 min / IP

### `artifacts/checkout`

React + Vite SPA, served from `$PORT`. Uses generated React Query hooks from `@workspace/api-client-react`.

- **Entry**: `src/main.tsx`
- **Router**: Wouter, base path from `import.meta.env.BASE_URL`
- **State**: TanStack React Query (server state), local React state (form steps)

### `lib/api-spec`

Single OpenAPI 3.1 YAML (`openapi.yaml`) that is the authoritative API contract. Orval config (`orval.config.ts`) drives code generation into `lib/api-client-react` and `lib/api-zod`.

### `lib/api-client-react`

Auto-generated React Query v5 hooks for every API operation. **Never edit these files manually** — regenerate with `pnpm --filter @workspace/api-spec run codegen`.

### `lib/api-zod`

Auto-generated Zod v4 schemas matching every OpenAPI component schema. Used for request/response validation both server- and client-side.

### `lib/db`

Drizzle ORM schema definitions and the database connection singleton. Exports all table objects and insert/select types.

---

## 5. Database Schema

All tables use PostgreSQL via Drizzle ORM. The connection string is read from `DATABASE_URL`.

### `bookings`

Core registration record. One row per checkout session.

| Column                            | Type          | Notes                                                                                 |
| --------------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `id`                              | serial PK     |                                                                                       |
| `session_token`                   | text UNIQUE   | Browser session identifier                                                            |
| `status`                          | enum          | `partial`, `pending_payment`, `paid`, `invoiced`, `cancelled`, `refunded`, `disputed` |
| `pass_type`                       | enum          | `single`, `business`                                                                  |
| `attendee_type`                   | enum          | `hr_professional`, `consultant_vendor`                                                |
| `quantity`                        | integer       | Number of passes                                                                      |
| `promo_code`                      | text          | Applied promo code (uppercase)                                                        |
| `promo_discount_amount`           | numeric(10,2) |                                                                                       |
| `group_discount_amount`           | numeric(10,2) |                                                                                       |
| `subtotal_amount`                 | numeric(10,2) | After discounts, excl. VAT                                                            |
| `vat_amount`                      | numeric(10,2) | 20% UK VAT                                                                            |
| `total_amount`                    | numeric(10,2) | Including VAT                                                                         |
| `payment_method`                  | enum          | `card`, `invoice`                                                                     |
| `stripe_session_id`               | text UNIQUE   | Stripe Checkout Session ID                                                            |
| `stripe_payment_intent_id`        | text          |                                                                                       |
| `stripe_invoice_id`               | text          |                                                                                       |
| `stripe_invoice_pdf_url`          | text          |                                                                                       |
| `stripe_invoice_payment_url`      | text          |                                                                                       |
| `stripe_invoice_status`           | text          | Cached from Stripe                                                                    |
| `stripe_invoice_status_synced_at` | timestamptz   | Cache freshness marker                                                                |
| `order_reference`                 | text UNIQUE   | `HRAS26-{6541+id}`                                                                    |
| `current_step`                    | integer       | Step 1–4 (checkout progress)                                                          |
| `billing_*`                       | text          | Full billing address fields                                                           |
| `po_number`                       | text          | Purchase order number                                                                 |
| `invoice_due_date`                | timestamptz   | 14 days from invoice creation                                                         |
| `paid_at`                         | timestamptz   |                                                                                       |
| `management_token`                | text UNIQUE   | Token for self-service URL                                                            |
| `hear_about_us`                   | text          | How registrant heard about the event                                                  |
| `confirmation_email_sent`         | boolean       | Per-side-effect delivery flag                                                         |
| `welcome_emails_sent`             | boolean       | Per-side-effect delivery flag                                                         |
| `organiser_notified`              | boolean       | Per-side-effect delivery flag                                                         |
| `sheets_synced`                   | boolean       | Per-side-effect delivery flag                                                         |
| `partial_notification_sent`       | boolean       | Abandoned checkout flag                                                               |
| `created_at` / `updated_at`       | timestamptz   |                                                                                       |

**Indexes**: `stripe_session_id` (unique), `stripe_payment_intent_id`, `stripe_invoice_id`, `order_reference` (unique), `promo_code`

### `attendees`

One row per person attending. Linked to `bookings` by `booking_id`.

| Column                     | Type        | Notes                    |
| -------------------------- | ----------- | ------------------------ |
| `id`                       | serial PK   |                          |
| `booking_id`               | integer FK  | References `bookings.id` |
| `is_lead`                  | boolean     | Lead/primary contact     |
| `first_name` / `last_name` | text        |                          |
| `job_title` / `company`    | text        |                          |
| `work_email`               | text        |                          |
| `phone`                    | text        |                          |
| `dietary_requirements`     | text        |                          |
| `accessibility_needs`      | text        |                          |
| `linkedin_url`             | text        |                          |
| `gdpr_consent`             | boolean     |                          |
| `gdpr_consent_at`          | timestamptz |                          |

### `promo_codes`

| Column                       | Type          | Notes                                                |
| ---------------------------- | ------------- | ---------------------------------------------------- |
| `id`                         | serial PK     |                                                      |
| `code`                       | text UNIQUE   | Always stored uppercase                              |
| `discount_type`              | enum          | `percentage`, `fixed`, `per_ticket`, `complimentary` |
| `discount_value`             | numeric(10,2) | Percentage or £ amount                               |
| `max_discount_amount`        | numeric(10,2) | Cap for percentage codes                             |
| `max_uses`                   | integer       | Null = unlimited                                     |
| `used_count`                 | integer       | Atomically incremented                               |
| `is_active`                  | boolean       |                                                      |
| `valid_from` / `valid_until` | timestamptz   | Date-range gating                                    |
| `description`                | text          | Internal label                                       |

### `discount_tiers`

Group discount tiers per pass type (e.g. 4+ Single passes → 10% off).

| Column             | Type                                |
| ------------------ | ----------------------------------- |
| `id`               | serial PK                           |
| `pass_type`        | enum (`single`, `team`, `business`) |
| `min_quantity`     | integer                             |
| `discount_percent` | numeric(5,2)                        |
| `label`            | text                                |

**Default tiers** (seeded on first start):

- Single: 4+ → 10%, 8+ → 15%, 12+ → 20%
- Business: 2+ → 10%, 5+ → 15%

### `email_templates`

Editable email templates for `confirmation` and `welcome` types. HTML body with `{{placeholder}}` variables. Seeded with defaults on first start.

### `email_logs`

Record of every email sent: `booking_id`, `type`, `recipient`, `subject`, `status`, `error`, `sent_at`.

### `notification_emails`

Admin-configurable list of email addresses that receive organiser notifications on each new booking.

### `pass_inventory`

Per-pass-type stock control: `pass_type`, `total_capacity`, `sold_count`, `reserved_count`, `is_sold_out_override`.

### `pass_config`

Admin-editable pass pricing, period name, and benefit lists. Overrides the hard-coded defaults in `pricing.ts` when present.

### `event_settings`

Key-value store for event configuration: event date/time, venue, social event details, and the Google Sheets spreadsheet ID.

### `activity_log`

Full audit trail. Every admin mutation writes a row: `actor`, `action`, `summary`, `entity_type`, `entity_id`, `before` (JSON diff), `after` (JSON diff), `meta`, `created_at`.

### `hear_about_us`

Admin-managed ordered list of "How did you hear about us?" options displayed on the checkout Step 1 form.

---

## 6. API Reference

All routes are prefixed `/api`. The full contract is in `lib/api-spec/openapi.yaml`.

### Health

| Method | Path           | Description                               |
| ------ | -------------- | ----------------------------------------- |
| `GET`  | `/api/healthz` | Health check — returns `{ status: "ok" }` |

### Bookings

| Method  | Path                          | Description                               |
| ------- | ----------------------------- | ----------------------------------------- |
| `POST`  | `/api/bookings`               | Create or upsert booking by session token |
| `GET`   | `/api/bookings/:sessionToken` | Get booking by session token              |
| `PATCH` | `/api/bookings/:id`           | Update booking fields                     |

### Attendees

| Method  | Path                        | Description                      |
| ------- | --------------------------- | -------------------------------- |
| `POST`  | `/api/attendees`            | Create attendee(s) for a booking |
| `GET`   | `/api/attendees/:bookingId` | List attendees for a booking     |
| `PATCH` | `/api/attendees/:id`        | Update a single attendee         |

### Pricing

| Method | Path                          | Description                                                    |
| ------ | ----------------------------- | -------------------------------------------------------------- |
| `GET`  | `/api/pricing`                | Calculate pricing (passType, quantity, promoCode query params) |
| `POST` | `/api/pricing/validate-promo` | Validate a promo code                                          |

### Promo Codes (public validate)

| Method | Path                        | Description               |
| ------ | --------------------------- | ------------------------- |
| `POST` | `/api/promo-codes/validate` | Validate code eligibility |

### Stripe

| Method | Path                                  | Description                                      |
| ------ | ------------------------------------- | ------------------------------------------------ |
| `POST` | `/api/stripe/create-checkout-session` | Create Stripe Checkout Session (card payment)    |
| `POST` | `/api/stripe/create-invoice`          | Create and send Stripe Invoice (invoice payment) |
| `POST` | `/api/stripe/webhook`                 | Stripe webhook handler (raw body required)       |
| `GET`  | `/api/stripe/session-status`          | Poll checkout session status                     |

### Email

| Method  | Path                              | Description              |
| ------- | --------------------------------- | ------------------------ |
| `GET`   | `/api/email/templates`            | List all email templates |
| `GET`   | `/api/email/templates/:type`      | Get a single template    |
| `PATCH` | `/api/email/templates/:type`      | Update template (admin)  |
| `POST`  | `/api/email/templates/:type/test` | Send test email          |
| `GET`   | `/api/email/logs`                 | List email send logs     |

### Admin (all require `x-admin-token` header)

| Method   | Path                                            | Description                                                    |
| -------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `POST`   | `/api/admin/login`                              | Authenticate with `ADMIN_PASSWORD` — rate-limited              |
| `GET`    | `/api/admin/stats`                              | Dashboard summary stats                                        |
| `GET`    | `/api/admin/registrations`                      | Paginated registrations list (filter by status, search, promo) |
| `GET`    | `/api/admin/registrations/export`               | CSV export of all registrations                                |
| `GET`    | `/api/admin/registrations/:id`                  | Get single registration detail                                 |
| `POST`   | `/api/admin/registrations/:id/redeliver`        | Retry failed post-confirmation side effects                    |
| `PATCH`  | `/api/admin/registrations/:id/status`           | Update booking status                                          |
| `DELETE` | `/api/admin/registrations`                      | Bulk-delete bookings                                           |
| `GET`    | `/api/admin/promo-codes`                        | List all promo codes                                           |
| `POST`   | `/api/admin/promo-codes`                        | Create promo code                                              |
| `PATCH`  | `/api/admin/promo-codes/:id`                    | Update promo code                                              |
| `DELETE` | `/api/admin/promo-codes/:id`                    | Delete promo code                                              |
| `PUT`    | `/api/admin/discount-tiers`                     | Replace all discount tiers for a pass type                     |
| `GET`    | `/api/admin/passes/inventory`                   | Get pass inventory                                             |
| `PUT`    | `/api/admin/passes/inventory/:passType`         | Update pass inventory                                          |
| `GET`    | `/api/admin/passes/config`                      | Get pass pricing config                                        |
| `PUT`    | `/api/admin/passes/config/:passType`            | Update pass pricing and benefits                               |
| `GET`    | `/api/admin/notification-emails`                | List organiser notification recipients                         |
| `POST`   | `/api/admin/notification-emails`                | Add notification recipient                                     |
| `PATCH`  | `/api/admin/notification-emails/:id`            | Update recipient                                               |
| `DELETE` | `/api/admin/notification-emails/:id`            | Remove recipient                                               |
| `GET`    | `/api/admin/activity`                           | Audit log (filterable by type, actor, date)                    |
| `GET`    | `/api/admin/unpaid-invoices`                    | List open/overdue invoices                                     |
| `GET`    | `/api/admin/unpaid-invoices/summary`            | Count and total of unpaid invoices                             |
| `POST`   | `/api/admin/unpaid-invoices/bulk-remind`        | Send invoice reminder emails in bulk                           |
| `POST`   | `/api/admin/bookings/:id/send-invoice-reminder` | Send reminder for a single invoice                             |

### Calendar

| Method | Path                       | Description                                      |
| ------ | -------------------------- | ------------------------------------------------ |
| `GET`  | `/api/calendar/main.ics`   | iCalendar file for the main summit (public)      |
| `GET`  | `/api/calendar/social.ics` | iCalendar file for the pre-event social (public) |

### Hear About Us

| Method   | Path                         | Description             |
| -------- | ---------------------------- | ----------------------- |
| `GET`    | `/api/hear-about-us`         | List active options     |
| `POST`   | `/api/hear-about-us`         | Add option (admin)      |
| `DELETE` | `/api/hear-about-us/:id`     | Remove option (admin)   |
| `PATCH`  | `/api/hear-about-us/reorder` | Reorder options (admin) |

### Manage (self-service, token-gated)

| Method  | Path                               | Description                                 |
| ------- | ---------------------------------- | ------------------------------------------- |
| `GET`   | `/api/manage/:token`               | Get booking + attendees by management token |
| `PATCH` | `/api/manage/:token/attendees/:id` | Update an attendee via management token     |
| `GET`   | `/api/manage/:token/billing`       | Get billing details                         |
| `PATCH` | `/api/manage/:token/billing`       | Update billing details                      |

---

## 7. Frontend Application

The checkout frontend is a React SPA served at the root path `/`.

### Routes

| Path                     | Component            | Description                           |
| ------------------------ | -------------------- | ------------------------------------- |
| `/`                      | `CheckoutFlow`       | Main multi-step checkout              |
| `/admin/login`           | `AdminLogin`         | Admin password entry                  |
| `/admin`                 | `AdminDashboard`     | Stats overview                        |
| `/admin/registrations`   | `AdminRegistrations` | Registrations list + management       |
| `/admin/promo-codes`     | `AdminPromoCodes`    | Promo code CRUD                       |
| `/admin/discount-tiers`  | `AdminDiscountTiers` | Group discount configuration          |
| `/admin/emails`          | `AdminEmails`        | Email logs + template editor          |
| `/admin/notifications`   | `AdminNotifications` | Organiser notification recipients     |
| `/admin/passes`          | `AdminPasses`        | Pass pricing, benefits, and inventory |
| `/admin/settings`        | `AdminSettings`      | Event settings (date, venue, social)  |
| `/admin/activity`        | `AdminActivity`      | Audit trail                           |
| `/manage/:token`         | `ManageAttendees`    | Self-service attendee editing         |
| `/manage/:token/billing` | `EditBilling`        | Self-service billing address edit     |

### Checkout Flow Steps

The checkout is a four-step linear form, resumable by session token (stored in `localStorage`):

1. **Step 1 — Your Details**: Lead attendee name, email, phone, job title, company, how they heard about the event. GDPR consent.
2. **Step 2 — Pass Selection**: Choose pass type (Single HR / Business Vendor), quantity, attendee type, apply promo code. Live pricing with VAT breakdown.
3. **Step 3 — Additional Attendees**: Fill in details for all non-lead seats (name, email, job title, company, dietary, accessibility, LinkedIn). Placeholder seats allowed — attendees can update via the management link later.
4. **Step 4 — Payment**: Choose card or invoice. Card → Stripe Checkout redirect. Invoice → billing details form (address, PO number, VAT number), then Stripe Invoice created and emailed.

After payment/invoice: **Confirmation page** showing order reference, attendee summary, pricing breakdown, and management link.

### Component Structure

```
src/
├── pages/
│   ├── checkout/
│   │   ├── index.tsx               # Step orchestrator
│   │   ├── Step1Lead.tsx
│   │   ├── Step2Passes.tsx
│   │   ├── Step3Attendees.tsx
│   │   ├── Step4Payment.tsx
│   │   ├── Confirmation.tsx
│   │   └── CompShortfallPrompt.tsx # UI for complimentary code seat cap
│   ├── admin/
│   │   ├── dashboard.tsx
│   │   ├── login.tsx
│   │   ├── registrations.tsx
│   │   ├── promo-codes.tsx
│   │   ├── discount-tiers.tsx
│   │   ├── emails.tsx
│   │   ├── notifications.tsx
│   │   ├── passes.tsx
│   │   ├── settings.tsx
│   │   └── activity.tsx
│   └── manage/
│       ├── ManageAttendees.tsx
│       └── EditBilling.tsx
├── components/
│   ├── ui/                         # shadcn/ui primitives
│   ├── layout/                     # Page shell, nav
│   ├── admin/                      # Admin-specific shared components
│   └── InvoiceBadge.tsx
├── hooks/
│   ├── use-mobile.tsx
│   └── use-toast.ts
├── lib/                            # Shared utilities
├── tokens.css                      # Design token CSS variables
└── index.css                       # Tailwind base + global styles
```

---

## 8. Admin Panel

Access at `/admin`. Protected by password + HMAC-signed token.

### Authentication

- Login via `POST /api/admin/login` with `{ password }` body
- Rate-limited: **5 attempts per 15 minutes per IP** (always on — cannot be disabled)
- On success: returns a token `<sigHex>.<expMs>` stored in `localStorage` as `admin_token`
- Token passed as `x-admin-token` request header on every subsequent admin API call
- Token TTL: **30 days**, enforced server-side
- Signature: HMAC-SHA256 keyed by `ADMIN_TOKEN_SECRET` (not the password) — a stolen token cannot be used to brute-force `ADMIN_PASSWORD` offline
- Startup guard: if `ADMIN_PASSWORD` matches a known weak value (`admin`, `admin123`, `password`, `123456`, `secret`, etc.), the server logs a warning and the admin panel returns `503` until a stronger password is set

### Admin Pages

| Page           | URL                     | Features                                                                                                                       |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Dashboard      | `/admin`                | Total bookings, revenue, attendees, recent activity                                                                            |
| Registrations  | `/admin/registrations`  | Search, filter by status, Stripe invoice links, overdue badges, Send Reminder, redeliver side effects, CSV export, bulk delete |
| Promo Codes    | `/admin/promo-codes`    | Create/edit/delete codes, usage tracking, date gating                                                                          |
| Discount Tiers | `/admin/discount-tiers` | Configure group discount thresholds per pass type                                                                              |
| Emails         | `/admin/emails`         | View send log, edit confirmation/welcome templates, send test emails                                                           |
| Notifications  | `/admin/notifications`  | Add/remove organiser notification email addresses                                                                              |
| Passes         | `/admin/passes`         | Edit prices, original prices, benefits list, inventory (capacity/sold/reserved, sold-out override)                             |
| Settings       | `/admin/settings`       | Event date/time, venue, pre-event social config, Google Sheets spreadsheet ID                                                  |
| Activity       | `/admin/activity`       | Full audit log with before/after diffs, filterable by type and actor                                                           |

### Audit Log

Every admin action writes to `activity_log`:

- Login success / failure (with source IP)
- Booking status changes, edits, deletes
- Promo code CRUD
- Discount tier changes
- Pass inventory / config changes
- Email template edits, test sends, resends
- Invoice reminder sends
- Notification email CRUD
- Event settings changes
- Hear-about-us add/delete/reorder
- Attendee admin edits

---

## 9. Pricing Engine

File: `artifacts/api-server/src/lib/pricing.ts`

All monetary values are computed in **integer pence** internally. Pounds appear only at the API boundary (`penceToPounds` / `poundsToPence` helpers).

### Pass Prices (defaults — overridable via admin pass config)

| Pass     | Type                | Price (excl. VAT) | Was    | Seats per unit |
| -------- | ------------------- | ----------------- | ------ | -------------- |
| Single   | HR Professional     | £199              | £429   | 1              |
| Team     | HR Professional     | £499              | £1,200 | 3              |
| Business | Consultant / Vendor | £599              | £999   | 1              |

> **Note**: The Team pass is a fixed-price bundle — 1 unit covers 3 seats.

### Calculation Order

1. **Base subtotal** = `pricePerUnit × billingUnits` (pence)
2. **Group discount** = largest matching tier percent × base subtotal (integer division, single `Math.round`)
3. **Promo discount** applied to `baseSubtotal − groupDiscount`:
   - `percentage`: `(afterGroup × pct) / 100`, capped by `max_discount_amount` if set
   - `per_ticket`: `perTicketAmount × quantity`, capped at afterGroup
   - `complimentary`: 100% off if `remainingSeats >= quantity`, else no discount (UI prompts user to reduce quantity)
   - `fixed`: flat amount, capped at afterGroup
4. **Subtotal after discounts** = `max(0, baseSubtotal − groupDiscount − promoDiscount)` (never negative)
5. **VAT** = `subtotalAfterDiscounts × 2000 / 10000` (20%, integer pence, single `Math.round`)
6. **Total** = `subtotalAfterDiscounts + vat`

### Promo Code Atomic Increment

`incrementPromoUsage()` uses a conditional `UPDATE … WHERE usedCount + inc <= maxUses` so concurrent confirmations cannot oversubscribe a capped code. For `complimentary` codes the counter increments by the booking quantity (tracks seats), for all other types by 1 (tracks bookings).

---

## 10. Payment Flows

### Card Payment (Stripe Checkout)

1. Frontend calls `POST /api/stripe/create-checkout-session` with `bookingId`
2. Server creates a Stripe Checkout Session, returns `{ url }`
3. Frontend redirects to Stripe-hosted payment page
4. On success: Stripe sends `checkout.session.completed` webhook
5. Webhook handler (`POST /api/stripe/webhook`) looks up booking by `stripe_session_id`, runs atomic confirmation inside a DB transaction:
   - Increments promo usage (if applicable)
   - Flips `status → paid`, sets `order_reference`, `paid_at`
   - Triggers post-confirmation side effects (email, Sheets, organiser notification)
6. Frontend polls `GET /api/stripe/session-status` and redirects to Confirmation page

### Invoice Payment (Stripe Invoicing)

1. Frontend collects billing details on Step 4, calls `POST /api/stripe/create-invoice`
2. Server runs `reissueBookingInvoice()`:
   - Finds or creates Stripe Customer (deduped by email), syncs billing address
   - Gets or creates UK VAT 20% tax rate in Stripe (cached per process)
   - Creates Stripe Invoice with line items: pass description, group discount (negative), promo discount (negative)
   - Finalizes and sends invoice via Stripe (14-day payment terms)
   - Stores `stripeInvoiceId`, `stripeInvoicePdfUrl`, `stripeInvoicePaymentUrl`, `invoiceDueDate`
   - Flips `status → invoiced`
3. Confirmation email is sent immediately with the real Stripe Invoice PDF attached
4. When customer pays online: Stripe sends `invoice.payment_succeeded` webhook → booking flipped to `paid`
5. Admin can send manual reminders from the Registrations panel (sends branded email with PDF + banking details)

### Invoice Footer (shown on every Stripe invoice)

```
Issued by: Dynamic Business Leaders Limited
Company No. 12252258  |  VAT No. 336124621
Registered Address: 45 Lemsford Village, Welwyn Garden City, Hertfordshire AL8 7TR
Bank: Tide (ClearBank)  |  Sort Code: 04-06-05  |  Account: 16963209
IBAN (GBP): GB65CLRB04060516963209  |  SWIFT: CLRBGB22
IBAN (EUR): GB45TCCL00997990500906  |  BIC: TCCLGB31
```

### Stale Invoice Status Sync

`refreshStripeInvoiceStatusIfStale()` is called on every booking read. If the cached `stripe_invoice_status_synced_at` is older than 5 minutes and the booking isn't already `paid`/`cancelled`, it fetches the live status from Stripe and persists it. `refreshStripeInvoiceUrls()` always fetches fresh (used on download/resend paths).

---

## 11. Email System

File: `artifacts/api-server/src/lib/email.ts`

Emails are sent via Nodemailer using SMTP credentials from environment variables.

### Email Types

| Type                       | Trigger                      | Recipients                             | Attachment                                    |
| -------------------------- | ---------------------------- | -------------------------------------- | --------------------------------------------- |
| **Confirmation**           | On booking payment/invoice   | Lead attendee (or billing contact)     | Stripe Invoice PDF (fallback: PDFKit receipt) |
| **Welcome**                | On booking payment/invoice   | Every individual attendee              | None                                          |
| **Organiser notification** | On new paid/invoiced booking | All addresses in `notification_emails` | None                                          |
| **Invoice reminder**       | Admin-triggered or bulk send | Billing contact                        | Stripe Invoice PDF                            |

### Email Template Variables

Templates use `{{placeholder}}` syntax. Available in confirmation/welcome:

| Variable                   | Description                                         |
| -------------------------- | --------------------------------------------------- |
| `{{firstName}}`            | Lead attendee first name                            |
| `{{orderReference}}`       | `HRAS26-XXXXX`                                      |
| `{{passLabel}}`            | Human-readable pass name                            |
| `{{quantity}}`             | Number of passes                                    |
| `{{quantityLabel}}`        | "pass" or "passes"                                  |
| `{{attendeesTable}}`       | HTML table of all attendees                         |
| `{{priceSummary}}`         | HTML price breakdown                                |
| `{{poNumberSection}}`      | PO number row (if set)                              |
| `{{eventDate}}`            | From event settings                                 |
| `{{eventVenue}}`           | From event settings                                 |
| `{{eventVenuePostcode}}`   | From event settings                                 |
| `{{eventCalendarLinks}}`   | "Add to Calendar" links block                       |
| `{{socialCalendarLinks}}`  | Pre-event social calendar links (if enabled)        |
| `{{managementLink}}`       | Self-service attendee management URL                |
| `{{invoicePaymentButton}}` | "Pay Invoice Online" button (invoice bookings only) |

### PDF Receipt Fallback

If the Stripe PDF URL is unavailable, `src/lib/pdf.ts` generates a branded PDFKit receipt with full VAT breakdown, order reference, and attendee list.

---

## 12. Google Sheets Integration

File: `artifacts/api-server/src/lib/google-sheets.ts`

Uses a Google service account with `spreadsheets` scope. Configured via three environment variables. The spreadsheet ID is stored in `event_settings` (editable in admin Settings page).

**Sheet structure**: One row per attendee. Booking-level fields are repeated on each row for flat analysis.

**Columns**: Order Reference, Booking Date, Pass Type, Quantity, Attendee Type, Payment Method, Booking Status, Seat Index, Is Lead, First Name, Last Name, Job Title, Company, Work Email, Phone, GDPR Consent, GDPR Consent At, Subtotal (exc VAT), VAT, Total (inc VAT), Promo Code, Group Discount, Promo Discount.

Headers are auto-created on first write if the sheet is empty.

### Required Secrets for Sheets

| Variable                             | Value                                                          |
| ------------------------------------ | -------------------------------------------------------------- |
| `GOOGLE_SHEETS_SPREADSHEET_ID`       | The ID from the Google Sheet URL                               |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | Service account `client_email`                                 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account `private_key` (with literal `\n` for newlines) |

---

## 13. Calendar / iCal Support

File: `artifacts/api-server/src/lib/ics.ts`

Two public iCalendar endpoints (no auth required):

- `GET /api/calendar/main.ics` — RFC-5545 file for the main summit
- `GET /api/calendar/social.ics` — RFC-5545 file for the pre-event social (returns 404 if social is not enabled or dates not configured)

Event data (start/end times, venue, description) is read from `event_settings`. Both endpoints return `404` with a plain-text body if the required settings are not yet configured.

Calendar links are injected into confirmation and welcome emails via the `{{eventCalendarLinks}}` and `{{socialCalendarLinks}}` template variables.

---

## 14. Environment Variables & Secrets

Set all secrets in the Replit Secrets panel (never in source code or `.env` files committed to git).

### Required for Core Operation

| Variable         | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection string (auto-provided by Replit PostgreSQL) |
| `ADMIN_PASSWORD` | Admin panel password. Must not be a common weak value.            |

### Required for Stripe Payments

| Variable                | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Stripe secret key (`sk_live_…` or `sk_test_…`)           |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe Dashboard (`whsec_…`) |

### Required for Email

| Variable     | Purpose                        | Default |
| ------------ | ------------------------------ | ------- |
| `SMTP_HOST`  | SMTP server hostname           | —       |
| `SMTP_PORT`  | SMTP port                      | `587`   |
| `SMTP_USER`  | SMTP username                  | —       |
| `SMTP_PASS`  | SMTP password                  | —       |
| `FROM_EMAIL` | Sender address shown in emails | —       |

### Required for Google Sheets (optional feature)

| Variable                             | Purpose                     |
| ------------------------------------ | --------------------------- |
| `GOOGLE_SHEETS_SPREADSHEET_ID`       | Target Google Sheet ID      |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | Service account email       |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account private key |

### Optional / Recommended

| Variable             | Purpose                                                                                                                                                | Default        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| `ADMIN_TOKEN_SECRET` | 32+ char random secret for signing admin session tokens. If absent, an ephemeral key is generated at startup — sessions won't survive server restarts. | auto-generated |
| `GITHUB_TOKEN`       | GitHub PAT (repo scope) used by the auto-sync script                                                                                                   | —              |

### Legacy / Unused

| Variable                  | Notes                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| `FREEAGENT_CLIENT_ID`     | FreeAgent OAuth — replaced by Stripe Invoicing, kept for reference |
| `FREEAGENT_CLIENT_SECRET` | As above                                                           |
| `FREEAGENT_REFRESH_TOKEN` | As above                                                           |

---

## 15. Running the Project

### Prerequisites

- Node.js 24
- pnpm (workspace-aware)
- A PostgreSQL database (Replit provides one automatically)

### First-time Setup

```bash
# Install all dependencies
pnpm install

# Run database migrations (Drizzle)
pnpm --filter @workspace/db run migrate

# Seed initial data (email templates, discount tiers, pass config)
# This happens automatically on first API server startup
```

### Development

The project uses Replit Workflows to run services. In development, three processes run concurrently:

| Service           | Port    | Command                                        |
| ----------------- | ------- | ---------------------------------------------- |
| API Server        | 8080    | `pnpm --filter @workspace/api-server run dev`  |
| Checkout Frontend | `$PORT` | `pnpm --filter @workspace/checkout run dev`    |
| GitHub Sync       | —       | `bash scripts/sync-to-github.sh` (every 5 min) |

### Production / Deployment

```bash
# Build everything
pnpm run build

# Start the API server (reads PORT from environment)
pnpm --filter @workspace/api-server run start

# Frontend is served as static files from Vite build output
```

---

## 16. Development Workflows

Configured as Replit Workflows (long-running processes managed by the platform):

| Workflow                           | Command                                                          | Purpose                             |
| ---------------------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev`                    | Express dev server with hot-reload  |
| `artifacts/checkout: web`          | `pnpm --filter @workspace/checkout run dev`                      | Vite dev server                     |
| `Sync to GitHub`                   | `while true; do bash scripts/sync-to-github.sh; sleep 300; done` | Auto-push to GitHub every 5 minutes |

### One-off Commands

```bash
# Type-check everything
pnpm run typecheck

# Lint
pnpm run lint

# Format check
pnpm run format

# Auto-format
pnpm run format:write

# Run tests
pnpm run test
```

---

## 17. Codegen & Type Safety

The project uses a strict **OpenAPI → codegen → TypeScript** pipeline. Never edit the generated files in `lib/api-client-react` or `lib/api-zod` directly.

### Adding a New API Endpoint

1. Add the path/operation to `lib/api-spec/openapi.yaml`
2. Run codegen to regenerate hooks and Zod schemas:
   ```bash
   pnpm --filter @workspace/api-spec run codegen
   cd lib/api-client-react && pnpm exec tsc --build
   ```
3. Implement the route handler in `artifacts/api-server/src/routes/`
4. Use the generated hook in the frontend

### Adding a New DB Table

1. Create the schema file in `lib/db/src/schema/`
2. Export it from `lib/db/src/schema/index.ts`
3. Rebuild DB declarations:
   ```bash
   cd lib/db && pnpm exec tsc --build
   ```
4. Run or write a Drizzle migration

### TypeScript Project References

Every package has `composite: true` in its `tsconfig.json`. Root `tsconfig.json` declares all project references. The build order is: `lib/db` → `lib/api-zod` → `lib/api-client-react` → `artifacts/*`.

---

## 18. GitHub Sync

The GitHub connection uses **manual branches and pull requests** — there is no automatic push to `main`. All syncing is triggered explicitly by running the scripts below.

Authenticates using the `GITHUB_TOKEN` Replit secret (PAT with `repo` scope).

### Push to a branch

```bash
# Auto-named branch (sync/YYYY-MM-DD-HHMMSS)
bash scripts/push-branch.sh

# Custom branch name
bash scripts/push-branch.sh my-feature-branch
```

Pushes the current workspace state to the named branch on GitHub. Never touches `main` directly.

### Open a Pull Request

```bash
BRANCH_NAME="my-feature-branch" bash scripts/create-pr.sh

# With a custom PR title and body
PR_TITLE="My change" PR_BODY="Details here" BRANCH_NAME="my-feature-branch" bash scripts/create-pr.sh
```

Creates a PR from the branch to `main` via the GitHub API. Prints the PR URL on success.

### Typical workflow

1. Make changes in Replit
2. `bash scripts/push-branch.sh my-branch-name`
3. `BRANCH_NAME="my-branch-name" bash scripts/create-pr.sh`
4. Review and merge the PR on GitHub

---

## 19. Security Notes

### Admin Authentication

- Passwords: startup-time blocklist of common weak values; server returns `503` until changed
- Rate limiting: 5 login attempts per 15 minutes per IP (always active)
- Token signature: HMAC-SHA256 keyed by `ADMIN_TOKEN_SECRET`, not the password — a leaked token cannot be used to recover the password offline
- Token TTL: 30 days, enforced server-side on every request
- Audit log: every login attempt (success + failure) is recorded with source IP

### Stripe Webhook

- Raw body required — Express `json()` middleware is bypassed for `/api/stripe/webhook`
- Signature verified with `stripe.webhooks.constructEvent()` using `STRIPE_WEBHOOK_SECRET`
- Idempotency: webhook handler checks `booking.status` before applying changes

### Financial Integrity

- All monetary arithmetic uses integer pence to eliminate floating-point drift
- Promo counter increment is a conditional `UPDATE` (not `SELECT` then `UPDATE`) to prevent race conditions
- Booking confirmation is fully transactional: status flip + promo increment commit or roll back together

### GDPR

- `gdpr_consent` + `gdpr_consent_at` stored per attendee
- Email addresses used only for event communications and optional Google Sheets export
- Management token is a cryptographically random UUID giving attendees access to their own data only

---

## 20. Brand & Design Tokens

Defined in `artifacts/checkout/src/tokens.css`.

| Token                | Value                 |
| -------------------- | --------------------- |
| Primary colour       | `#E74F3E` (red)       |
| Secondary colour     | `#F48847` (orange)    |
| Background           | `#FCFBFA` (off-white) |
| Heading font         | Clarkson              |
| Body font            | Figtree               |
| Input border-radius  | `0px` (square)        |
| Button border-radius | `300px` (pill)        |

shadcn/ui components are used throughout the admin panel and checkout. Tailwind utility classes follow the token values.

---

## 21. Order Reference Format

```
HRAS26-{6541 + bookingId}
```

Examples: first booking → `HRAS26-6542`, second → `HRAS26-6543`, etc.

The offset `6541` ensures all references are 4+ digits and avoids `HRAS26-1` looking like a test booking. Generated at payment/invoice completion and stored as a unique index on `bookings.order_reference`.

---

## 22. Key Business Rules

- **VAT**: Always 20% UK VAT, always shown as a separate line item. Never included in the displayed pass prices (all prices quoted ex-VAT).
- **Team pass**: Fixed bundle price (£499 for 3 seats). Additional bundles priced per unit, not per seat.
- **Complimentary promo codes**: If `quantity > remainingSeats`, the discount does not apply and the UI shows a `CompShortfallPrompt` asking the user to reduce quantity or remove the code.
- **Promo + group discounts**: Both can apply simultaneously. Group discount is calculated first on the base subtotal; promo is applied to the post-group-discount amount.
- **Invoice due date**: 14 calendar days from invoice creation.
- **Overdue detection**: Admin Registrations table shows "Overdue" badge (red) when `invoiceDueDate < today` and `status = invoiced`.
- **Booking resumption**: A returning visitor with an existing `sessionToken` in `localStorage` resumes at their last saved `currentStep`.
- **Placeholder attendees**: Buyers can leave non-lead seats with minimal details and share the management link with colleagues to fill their own information.
- **Billing edits**: Available via `/manage/:token/billing` — updates billing fields on the booking row. Does not re-issue or modify the Stripe invoice.
- **Invoice re-issue**: When an admin triggers a re-issue, the existing open Stripe invoice is voided/deleted before a new one is created. Already-paid invoices short-circuit with no changes.
- **Partial bookings**: Bookings in `partial` status (incomplete checkout) trigger a `partial_notification_sent` flag after a configurable period. Admin can see and manage these.
- **Side-effect retries**: Each post-confirmation side effect has its own boolean flag. The `POST /api/admin/registrations/:id/redeliver` endpoint re-runs only the failed ones.

---

_Built and maintained on Replit. Synced to GitHub (`Dougy-cpu/CODEX-Register-HRAS`) via manual branch + PR workflow._

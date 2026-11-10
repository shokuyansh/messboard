# IIIT Bhubaneswar Mess Management

A web application for managing campus mess meals, attendance and monthly bills. Students can plan their meals and track their records, while administrators manage menus, accounts and attendance-based billing from a shared dashboard.

The campus meal-board interface uses horizontal navigation, numbered meal rows and a warm paper, ink and orange palette. The frontend uses HTML, CSS and vanilla JavaScript. A Node.js API handles authentication and mess operations, with records stored in a Turso/libSQL database. The project is configured for deployment on Vercel.

This is an independent student project and is not an official institute service.

## Features

### Students

- Register and sign in with an email and password.
- Maintain a profile with a name and unique roll number.
- View the weekly breakfast, lunch and dinner menus.
- Book or skip individual meals from today up to 30 days ahead.
- Check in for today's booked meals and view attendance history.
- View pending monthly bills and a reminder to clear dues with the mess manager by the end of the month.

### Administrators

- Review bookings and attendance for a selected date.
- Edit the shared weekly menu.
- View student profiles, change account roles and activate or deactivate accounts.
- Review monthly meal charges calculated from each student’s check-ins.

## How it works

The browser sends requests to `/api/*`. The API identifies the signed-in account through a session cookie, checks permissions and reads or updates the database. Student records belong to the authenticated account; administrative actions require an administrator role stored in the database.

Locally, the application uses a SQLite file under `.data/`. On Vercel, it connects to a hosted Turso/libSQL database so records persist across deployments. SQL migrations in `drizzle/` create and update the tables.

Meal dates follow **Asia/Kolkata**. Each student can have one booking and one attendance entry per meal per day. A meal cannot be changed after check-in.

## Meal pricing and billing

| Meal | Price per check-in |
| --- | --- |
| Breakfast | ₹30 |
| Lunch | ₹45 |
| Dinner | ₹40 |

New accounts start with no amount due. Monthly charges come from attendance records: breakfast check-ins × ₹30 + lunch check-ins × ₹45 + dinner check-ins × ₹40. Booking or skipping a meal does not create a charge. Duplicate check-ins are rejected.

The rates appear in Overview and Billing. Students see their monthly meal counts and totals; administrators can view totals for all students. Dues are cleared with the mess manager by the end of the month. The app does not record payment settlements.

Old flat bills, including the default ₹3,200 charge, are excluded from current totals. Their database records are retained for reference. Feedback and notification features are no longer available.

## Run locally

Requires **Node.js 22** and npm. From the project directory:

```bash
npm ci
cp .env.example .env.local
```

Edit `.env.local`:

```dotenv
TURSO_DATABASE_URL=file:.data/mess.db
TURSO_AUTH_TOKEN=
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=replace-with-a-unique-password
```

Use your own administrator email and a password between 12 and 128 characters. The token can stay empty when using the local SQLite file.

Start the application:

```bash
npm run dev
```

Open **http://127.0.0.1:3000**. Pending database migrations run automatically at startup. Add `PORT=3001` to `.env.local` if you need a different port.

### First login

Use **Sign in** with the administrator email and password from your environment settings. The first successful login creates the administrator account. That email is reserved and cannot be claimed through student registration.

Students use **Student registration** to create their accounts. After signing in, complete the profile with a roll number before booking meals.

Once the administrator account exists, changing `ADMIN_PASSWORD` in the environment does not change its stored password. Password recovery is not implemented.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local frontend and API; apply pending migrations |
| `npm test` | Run the API and account/database tests |
| `npm run build` | Check application files and configuration; apply pending migrations |
| `npm run db:migrate` | Apply pending migrations to the configured database |
| `npm run deploy` | Deploy to production through the Vercel CLI; requires login and project setup |

The tests cover account registration, administrator access, student record isolation, sessions, booking and billing rules, duplicate prevention, request validation and migration behavior.

## Project structure

```text
api/index.js          Vercel API entry point
public/               HTML, CSS, browser JavaScript and favicon
lib/auth.js           Registration, passwords and sessions
lib/app-handler.js    API routing and session identity
lib/mess-api.js       Meal, attendance, billing and administration logic
lib/database.js       libSQL connection and query adapter
drizzle/              Versioned SQL migrations
scripts/              Local server, build checks and migration runner
tests/                API and account/database tests
vercel.json           Vercel build, routing and header configuration
```

Migration `0003_pending_bills_and_profiles.sql` removes hostel data and returns old simulated bills to pending while retaining their amounts. Simulated receipts and activity entries are removed because they were not real payments.

Booking and check-in responses include the confirmed record, so the browser updates the meal without fetching the entire workspace again. Each save uses one session lookup and one transaction for the meal record and activity entry. Workspace reads are batched into one database request.

Add new SQL migration files when changing the schema. Applied migrations are tracked by checksum; editing an applied file causes the migration runner to stop.

## Authentication and access

Passwords are stored as salted scrypt hashes. Sessions expire after seven days, and the database stores hashes of session tokens. Session cookies use `HttpOnly` and `SameSite=Lax`, with `Secure` enabled over HTTPS.

Email syntax is checked in the browser and API, with inline errors on sign-in and registration. This does not verify mailbox ownership. The API checks account roles on the server, limits login attempts per email and rejects cross-origin writes. Write requests require JSON and the `X-Mess-Request: 1` header. Database queries use bound parameters.



# IIIT Bhubaneswar Mess Management

A web application for managing campus mess meals, attendance and monthly bills. Students can plan their meals and track their records, while administrators manage menus, accounts, billing and feedback from a shared dashboard.

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
- Submit rated feedback and read mess announcements.

### Administrators

- Review bookings and attendance for a selected date.
- Edit the shared weekly menu.
- View student profiles, change account roles and activate or deactivate accounts.
- Issue monthly bills and correct pending charges.
- Review feedback and update its status.
- Publish and remove announcements.

## How it works

The browser sends requests to `/api/*`. The API identifies the signed-in account through a session cookie, checks permissions and reads or updates the database. Student records belong to the authenticated account; administrative actions require an administrator role stored in the database.

Locally, the application uses a SQLite file under `.data/`. On Vercel, it connects to a hosted Turso/libSQL database so records persist across deployments. SQL migrations in `drizzle/` create and update the tables.

Meal dates follow **Asia/Kolkata**. Each student can have one booking and one attendance entry per meal per day. A meal cannot be changed after check-in.

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

## Deploy to Vercel

### 1. Create the database

Create a hosted **libSQL** database in Turso. Copy its database URL and generate a database authentication token with read/write access. The URL should start with `libsql://` or `https://`.

The application already includes `@libsql/client`. Leave the new database empty; the build will create the tables.

### 2. Import the GitHub repository

In Vercel, import the repository containing this project's `package.json` and `vercel.json`. Use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | Repository root, or this project's subdirectory if using a monorepo |
| Node.js version | 22.x |
| Build command | `npm run build` |
| Output directory | `public` |

`vercel.json` defines API routing, response headers and the Mumbai function region (`bom1`). Keep the Turso database in Mumbai as well to reduce database round-trip latency.

### 3. Add environment variables

Set these values for the **Production** environment before deploying:

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | The hosted database URL, such as `libsql://iiit-mess-your-org.turso.io` |
| `TURSO_AUTH_TOKEN` | A read/write authentication token for that database |
| `ADMIN_EMAIL` | The email used for the initial administrator login |
| `ADMIN_PASSWORD` | A unique administrator password between 12 and 128 characters |

Store credentials in Vercel's environment settings. `.env.local` is excluded from Git. File-based and in-memory database URLs are rejected on Vercel because they cannot provide persistent application storage.

### 4. Deploy and sign in

Deploy the project. The build validates the configuration and applies pending database migrations. Open the deployment URL and sign in with your configured administrator credentials.

If you change environment values after a deployment, redeploy to apply them. Preview deployments also need environment values to build and use the API; give previews a separate database to keep test records and migrations away from production.

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

## Current limits

- Payments are handled by the mess manager. The application displays pending charges and does not collect payments or record settlements.
- Attendance is reported by the student; it does not verify physical presence.
- Billing uses a flat monthly charge. Skipping meals does not reduce the bill.
- New databases start with sample menus and a default monthly charge of ₹3,200. Administrators can update these values.
- Email verification and password reset emails are not implemented. Registration does not verify institute membership.
- Administrator views show up to 500 accounts, 500 bills and the latest 100 feedback entries.

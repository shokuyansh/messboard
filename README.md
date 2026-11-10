# IIIT Bhubaneswar Mess Hub — Vercel edition

The full mess management application adapted for **Vercel**, with a plain HTML/CSS/JavaScript frontend, a Node.js serverless API and a persistent Turso/libSQL database.

This folder is independent of the existing Cloudflare/Sites deployment. It contains no Cloudflare bindings or platform-specific sign-in dependency. Booking, attendance, billing, feedback, menus and administration features are retained.

## Run locally

Requires Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local
```

Edit `.env.local` and set `ADMIN_EMAIL` to your email and `ADMIN_PASSWORD` to a unique password of at least 12 characters. Leave `TURSO_DATABASE_URL=file:.data/mess.db` for local SQLite development.

```bash
npm run dev
```

Open **http://127.0.0.1:3000**. Sign in with the configured administrator credentials. The first successful administrator login creates the reserved admin account; public registration cannot claim that email. Complete the profile and use **Administration**. Other users create student accounts through the registration form.

The local server applies pending migrations automatically. Local SQLite records persist under `.data/`. To choose another local port, set `PORT` in `.env.local`.

## Deploy to Vercel

Deployment requires an authenticated Vercel account and a persistent hosted database. The project is prepared locally; it has not been published to Vercel yet.

1. Create/import this folder as a Vercel project. Select the **Other** framework preset. `vercel.json` supplies the build command, output directory, API rewrite and security headers.
2. Add a **Turso Cloud** database through Vercel Marketplace and connect it to the project. Use a free plan if available; do not activate a paid plan unintentionally.
3. Confirm that the database integration supplied `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the project's production environment. The database must use a `libsql://` or `https://` URL.
4. Add `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` as sensitive environment values. The email is reserved from student registration. The password initializes the first admin account and is subsequently stored as a salted password hash in the database.
5. Deploy. `npm run build` validates the required settings and applies pending SQL migrations before the frontend and API are published.
6. Open the returned deployment URL and sign in with the administrator credentials. New students can then register their own accounts.

If deploying from your terminal:

```bash
npx vercel login
npx vercel link
# Connect the database and configure the four environment values in Vercel.
npm run deploy
```

Do not put production credentials in `vercel.json`, client JavaScript, Git or the ZIP archive. Configure environment values for previews as well if preview deployments need to use the backend; use a separate preview database to keep preview migrations and records away from production.

Vercel deployments explicitly refuse file-based or in-memory databases. Using temporary serverless disk storage would lose records across instances or deployments. Locally, a file database is supported for development.

Changing the `ADMIN_PASSWORD` environment value after the admin account is created does not replace the stored password. Manage existing credentials through a controlled database/account recovery process. Email verification, password reset emails and real payment collection are not implemented.

The database starts with shared sample menus and a sample ₹3,200 monthly charge. Existing records from the Cloudflare/Sites deployment are not copied into this separate database.

## Verification

```bash
npm test
npm run build
```

The project has **22 API tests**: 13 mess-management tests and 9 account/database integration tests. These cover student isolation, admin authorization, password/session hashing, reserved admin registration, logout, session expiry, account deactivation, CSRF checks, login attempt limits, API rewriting, atomic SQL rollback, migrations, billing and duplicate prevention.

Browser checks cover student registration, profile updates, bookings, attendance, feedback, logout/login, separate admin access, admin review, cross-account visibility, persistence after clearing browser storage and mobile layouts. Local verification is complete; a Vercel deployment still requires account access and hosted database provisioning.

## Structure

```text
public/index.html         HTML interface
public/styles.css         Responsive design
public/app.js             Vanilla JS UI and API requests
api/index.js              Vercel Node.js fetch entrypoint
lib/app-handler.js        Routing and server-side session identity
lib/auth.js               Account registration, passwords and sessions
lib/database.js           Persistent SQL client and query adapter
lib/mess-api.js           Existing mess-management business logic
drizzle/                  Versioned SQL migrations
scripts/migrate.mjs       Checksum-verified, repeatable migrations
scripts/build.mjs         Deployment validation and database migrations
scripts/dev.mjs           Local frontend/backend server
tests/                    Business logic and account integration tests
vercel.json               Vercel build, routing and security configuration
```

Student identity comes only from a database-backed session cookie. Client-provided identity headers and role values are ignored. Cookies use HttpOnly and SameSite=Lax; HTTPS deployments also use Secure and the `__Host-` prefix. Passwords use salted scrypt hashes, and only hashes of session tokens are stored in SQL. Account login attempts are limited per email address. All administrative operations check the stored database role.

The API is exposed under `/api/*`. Authentication uses POST `/api/auth/register`, `/api/auth/login` and `/api/auth/logout`. The remaining student/admin API endpoints are the same as the original dynamic application. Every write requires JSON, a same-origin request and `X-Mess-Request: 1`.

Payments remain **explicit simulations**. Records and receipts are saved in SQL, but no money is collected. Student attendance is self-reported.

## Platform references

- [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Turso Cloud on Vercel Marketplace](https://vercel.com/marketplace/tursocloud)
- [Turso/libSQL JavaScript client](https://docs.turso.tech/sdk/ts/reference)

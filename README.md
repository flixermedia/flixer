## Code formatting

Prettier is configured for the project with tab indentation displayed at a four-column width. Run `npm run format` to format supported project files, or `npm run format:check` to verify formatting without changing files. In VS Code, install the recommended Run On Save extension; the workspace settings then run the custom formatter on the saved file. Block-bodied function declarations receive blank lines after their opening brace and before their closing brace, except declarations whose body is a single `return` statement, which use standard Prettier spacing. Callback functions use standard Prettier spacing. Non-empty class declarations receive a blank line after their opening brace, and arrays beginning with string entries followed by an object keep those initial strings on the opening line. `scrypt` callback calls keep their leading arguments on one line. Decorators stay directly above their declarations. Dependencies, build output, the npm lockfile, and the local generated-user credentials are excluded.

## Updating the Insomnia API collection

Run `npm run insomnia:update` to create or refresh `insomnia/flixer-insomnia.json`. The script creates the collection and its parent directory first. If the local OpenAPI endpoint is unreachable, it runs Ts.ED's barrel generator and starts the development server directly as a hidden Node.js process, then waits up to two minutes for OpenAPI to become available. After generation (or an error), it stops only the server it started; it does not stop a server that was already running or open a separate `cmd.exe` window. If startup fails, its captured output is included in the updater's error message. This automatic startup applies to local HTTP URLs only. The update preserves the Insomnia workspace and existing environment values, regenerates requests from the documented API operations, and creates development environment entries for every variable referenced by those requests. [Faker](https://fakerjs.dev/) generates appropriate examples for new variables (such as usernames, emails, passwords, IDs, names, dates, phone numbers, and locations); existing values are preserved on update. The generated test account's username, email, and password are persisted in `insomnia/flixer-user.json` and reused for subsequent collection generations. Authentication values such as tokens and captured user/session IDs start empty.

The login request has an after-response script that stores the returned `accessToken` as `access_token`, `user.id` as `user_id`, and `session.id` as `session_id` in the active Insomnia environment. Generated secured requests use the bearer token, and user/session requests use the populated IDs.

Set `OPENAPI_URL` to use a different running server (defaults to `http://localhost:8083/scalar/doc/openapi.json`) or `INSOMNIA_FILE` to update a different collection file.

### User access

The first account registered through the API is assigned the `admin` role; subsequent registrations receive the `user` role. Registration uses a PostgreSQL transaction lock so concurrent first sign-ups cannot both become administrators. To promote an additional trusted account, update its role directly in PostgreSQL:

```sql
UPDATE users SET role = 'admin' WHERE username = 'your-username';
```

Then log in again (the API reads the current role from the database). Admins can read and delete any user. Regular users can only read their own account and delete it by sending their current password.

### Authentication sessions

Each successful registration or login creates a persisted session. Access tokens are tied to that session, so revoking or deleting the session invalidates its token on the next authenticated request.
Expired session rows are removed when the application starts and by an hourly scheduled job. Expired tokens are rejected even before cleanup runs.

Scheduled and background jobs are managed by [pg-boss](https://github.com/timgit/pg-boss), an MIT-licensed PostgreSQL-backed job queue. It uses the existing `DATABASE_URL`; no Redis service is needed. Supabase hosts and URLs with an SSL-required mode automatically use verified TLS for both TypeORM and pg-boss connections. If Node.js does not trust the database certificate, download the database CA certificate from Supabase **Database Settings > SSL Configuration** and set `DATABASE_SSL_CA_PATH` in `.env` to its local path. Certificate verification remains enabled. pg-boss creates and manages its own `pgboss` schema, so the database role must be permitted to create that schema and its tables. It requires PostgreSQL 13+ and Node.js 22.12+. Add future job handlers and schedules in `src/jobs` and register them in `JobScheduler`.

- `GET /api/jobs/queues` lists pg-boss queues and their current counts.
- `GET /api/jobs/queues/:queueName/jobs?limit=100` lists jobs; the limit must be between 1 and 1000.
- `GET /api/jobs/queues/:queueName/jobs/:jobId` inspects a job.
- `POST /api/jobs/queues/:queueName/jobs` enqueues a job with an optional `{ "data": {} }` body.
- `POST /api/jobs/queues/:queueName/jobs/:jobId/retry` retries a job.
- `DELETE /api/jobs/queues/:queueName/jobs/:jobId` cancels a job.
- `GET /api/jobs/schedules` lists recurring schedules.
- `PUT /api/jobs/schedules/:queueName` creates or updates a schedule with `{ "cron": "0 * * * *", "data": {} }`.
- `DELETE /api/jobs/schedules/:queueName` removes a schedule.

All job-management routes require a valid bearer token for an account whose current database role is `admin`. Job operations are currently restricted to queues with an application worker registered; at present, that is `cleanup-expired-user-sessions`. Add and register a worker before exposing another queue through the API.

- `GET /api/auth/sessions` lists the signed-in user's active sessions and marks the current one.
- `DELETE /api/auth/sessions/:sessionId` revokes one of the signed-in user's sessions.
- `POST /api/auth/logout` revokes the current session.

The login/register response includes `session.id`. The Insomnia login script stores it as `session_id`; its logout and current-session revoke scripts clear the saved credentials.

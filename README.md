# Counter

Agentic commerce for the world's small makers. Built for the PayPal hackathon (Oct–Nov 2026).

Design docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [Buildout plan](docs/BUILDOUT.md)

## Run locally

Requires Node 24.22.1+ (`.nvmrc`) and pnpm via Corepack.

```sh
corepack enable
pnpm install
cp .env.example .env   # fill in values; the server refuses to start if any required var is missing
pnpm db:up             # Postgres 17 in Docker on localhost:5433 (dev DB `counter`, test DB `counter_test`)
pnpm db:migrate
pnpm dev
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`. DB tests run when `TEST_DATABASE_URL` is set.

Schema changes: edit `lib/db/schema.ts`, then `pnpm db:generate` and commit the new file in `drizzle/`.

## Deploy (Render)

`render.yaml` is a Render Blueprint: one web service and one Postgres 17 database, on paid plans so the service never sleeps and the database outlives the free tier's 30 days.

1. In Render: **New → Blueprint**, pick this repo.
2. Fill the prompted secrets: `PLATFORM_CLIENT_ID`, `PLATFORM_CLIENT_SECRET`, `ANTHROPIC_API_KEY`. `PAYPAL_WEBHOOK_ID` can stay blank until the webhook exists.
3. Each deploy runs migrations (`node scripts/migrate.ts`) before starting, and Render waits for `/api/health` to return 200. Pushes to `main` deploy after CI passes.

The database accepts no external connections by default; add your IP under the database's **Access Control** to connect from a laptop.

## License

[MIT](LICENSE)

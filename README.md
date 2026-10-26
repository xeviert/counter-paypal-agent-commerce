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

## License

[MIT](LICENSE)

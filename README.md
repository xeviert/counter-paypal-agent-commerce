# Counter

Agentic commerce for the world's small makers. Built for the PayPal hackathon (Oct–Nov 2026).

Design docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [Buildout plan](docs/BUILDOUT.md)

## Run locally

Requires Node 24.22.1+ (`.nvmrc`) and pnpm via Corepack.

```sh
corepack enable
pnpm install
cp .env.example .env   # fill in values; the server refuses to start if any required var is missing
pnpm dev
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## License

[MIT](LICENSE)

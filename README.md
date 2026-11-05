# Counter

Agentic commerce for the world's small makers. Built for the PayPal hackathon (Oct 24 – Nov 12, 2026).

A weaver in Oaxaca records a voice note in Spanish and takes two photos. Claude turns that into a listing in English and Spanish with a suggested price. A shopping agent (Claude, or anything that speaks MCP) finds the rug, asks the maker a question, negotiates within her floor price and creates a PayPal checkout. The buyer approves on PayPal; PayPal holds the money until the rug ships and arrives, then pays the maker in her own PayPal account, minus Counter's 5% fee.

Everything runs on the PayPal sandbox. Design docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [Buildout plan and status](docs/BUILDOUT.md)

## Try it

Live demo: https://counter-2cdt.onrender.com (the root page has the same steps).

- **Buy as an agent:** in claude.ai, Settings → Connectors → Add custom connector, URL `https://counter-2cdt.onrender.com/api/mcp`, choose No sign-in. Then ask, e.g. "Find me a handwoven rug from Oaxaca under $200, shipped to the US. Ask the maker how to clean it, then offer a bit less and check out." Approve the payment with the sandbox buyer account from the Devpost testing instructions
- **Sell as a maker:** `/s/login`, pick a demo maker (Mexico, the Philippines, Kenya). Best on a phone: list a piece by voice, see orders, ship, refund, ask the copilot, open the dashboard
- **Operate:** `/ops` (judge login in the Devpost testing instructions): order events, fees, flagged listings, operator copilot
- **For agents:** `/llms.txt`, `/feed.json`, `/api/acp/checkout_sessions`

## How it works

```mermaid
flowchart LR
  M["Maker (phone)<br/>voice + photos"] --> L["Listing builder<br/>Claude"]
  L --> DB[("Postgres")]
  A["Buyer agent<br/>Claude · any MCP client"] -- "MCP / ACP" --> API["Counter<br/>Next.js on Render"]
  API --> DB
  API -- "offers" --> N["Negotiator<br/>Claude + policy clamp"]
  API -- "orders · capture · tracking<br/>release · refund" --> PP["PayPal<br/>Platform + ISU"]
  H["Human buyer"] -- "approves" --> PP
  PP -- "webhooks" --> API
  PP -- "payout after delivery" --> M
```

- One Next.js 16 app on Render (web service, every-minute cron sweep, Render Workflows for the listing pipeline) and one Postgres
- The model never sets a price or moves money: every amount comes from the database, offers are clamped to the maker's floor in code, and only code paths call PayPal (ARCHITECTURE §5.2)
- Image version for slides: [docs/architecture.png](docs/architecture.png)
- The order lifecycle is one state machine with a row lock and an `events` row per transition (ARCHITECTURE §6.5)

## PayPal APIs used

Counter is a PayPal **Platform** partner. Makers connect their own PayPal business account through Integrated Sign-Up, and Counter acts for them with `PayPal-Auth-Assertion`.

| Step | API |
|---|---|
| Maker onboarding | `POST /v2/customer/partner-referrals`, `GET /v1/customer/partners/{partner}/merchant-integrations` |
| Checkout | `POST /v2/checkout/orders` with `payee`, `platform_fees`, `disbursement_mode: DELAYED`; `POST /v2/checkout/orders/{id}/capture` |
| Tracking | `POST /v2/checkout/orders/{id}/track` (as the maker) |
| Release held funds | `POST /v1/payments/referenced-payouts-items` |
| Refund | `POST /v2/payments/captures/{id}/refund` (as the maker) |
| Webhooks | `POST /v1/notifications/verify-webhook-signature`; captures, refunds, payouts, disputes |
| Operator copilot | `GET /v1/reporting/transactions` (Transaction Search) |

Every money call carries a `PayPal-Request-Id`, so retries and double clicks are safe.

## Claude roles

| Role | Model | Eval | ~Cost per call |
|---|---|---|---|
| Listing builder (photos + transcript → listing in 2 languages, price guidance) | Sonnet 5.5 | `pnpm eval:listing` | $0.007–0.010 |
| Negotiator (offer → accept / counter, clamped in code) | Sonnet 5.5 | `pnpm eval:negotiator`: Sonnet 10/10, Opus 10/10 | $0.002 |
| Buyer-question answerer | Sonnet 5.5 | `pnpm eval:answerer`: Sonnet clean in 4 of 4 runs, Haiku 2 of 6 | $0.002 |
| Seller copilot (maker's language; proposes refunds, never runs them) | Opus 5.5 | `pnpm eval:copilot`: Opus 40/40, Sonnet 37/40 | $0.003–0.011 |
| AG Studio dashboard agents | Opus 5.5 | in the browser | $0.03 avg |
| Operator copilot (read-only) | Sonnet 5.5 | `pnpm eval:operator`: both 8/8 | $0.002–0.005 |

Prompt injection: `pnpm eval:injection` sends hostile offers and questions through the real MCP server (7/7 on Nov 5: prices stayed in `[floor, list]`, no floor or maker contact details leaked). All roles share `AI_DAILY_CALL_CAP` (300 calls per UTC day) plus per-maker daily limits; `pnpm cost:report` shows spend per role from the `ai.call` log.

## AG Studio dashboard

`/s/dashboard` is an AG Studio report over the maker's own orders, products and agent activity (searches, questions, offers, checkouts per day). Studio's built-in agents run in the browser and call Claude through Counter's `/s/api/studio-ai` proxy, so the model sees only the rows on the page. Each maker's edits are saved. Counter adds one custom widget, a payout timeline (when each order's money reaches the maker: paid out, release date set, or waiting for tracking), which Studio's agents can place too: ask "When do I get paid?".

## ACP checkout

`/api/acp/checkout_sessions` speaks the [Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) checkout API, pinned to `2025-09-29`: `POST /` create, `GET /{id}`, `POST /{id}` update, `POST /{id}/complete`, `POST /{id}/cancel`. Same products, prices, shipping and policy checks as the MCP tools.

- Headers: `Idempotency-Key` (replays the stored response; a different body is a 422) and `Request-Id` are honored and echoed; responses carry `API-Version: 2025-09-29`. `Authorization`, `Signature` and `Timestamp` are ignored: like `/api/mcp`, it's anonymous
- Deviations: `complete` takes no payment token. It creates a PayPal order and returns `status: completed` with `order.permalink_url` (the order status page) and the PayPal approval link in `messages`; a human approves the payment there. One item per session, list price only (negotiation is MCP-only), `links` is empty. A completed session can still be canceled until the buyer approves

```sh
curl -X POST "$BASE/api/acp/checkout_sessions" -H 'content-type: application/json' -H 'Idempotency-Key: 1' \
  -d '{"items":[{"id":"<productId>","quantity":1}],"fulfillment_address":{"name":"Sam","line_one":"1 Main St","city":"Berlin","state":"BE","country":"DE","postal_code":"10115"}}'
```

## Voice + accessibility

- A buyer can shop by voice through Claude's mobile voice mode with Counter added as a custom connector (`/api/mcp`). Tool replies are plain sentences with ids on the last line, so they read aloud well
- The one step that isn't voice: the buyer approves the payment on PayPal's own page, which is outside Counter's control
- The maker app is in English, Spanish, Filipino and Swahili, sized for a phone, with 44 px touch targets
- `pnpm a11y` runs axe (WCAG 2.2 AA) over the buyer pages and the maker app at phone size and fails on any serious or critical issue (`--screenshots <dir>` saves a PNG per page). Start the server with the same `SESSION_SECRET` and database as the script (it signs a demo maker's cookie and adds a temporary draft): `pnpm build`, `SESSION_SECRET=… DEMO_LOGIN=true pnpm start`, then `SESSION_SECRET=… pnpm a11y [--base-url …] [--all]`. First run: `pnpm exec playwright install chromium`

## Run locally

Requires Node 24.22.1+ (`.nvmrc`), pnpm via Corepack, and Docker for Postgres.

```sh
corepack enable
pnpm install
cp .env.example .env   # then set the values below
pnpm db:up             # Postgres 17 in Docker on localhost:5433 (dev DB `counter`, test DB `counter_test`)
pnpm db:migrate
pnpm seed --local      # demo makers + 30 products, sellable without PayPal onboarding
pnpm seed:activity     # 30 days of dashboard history
pnpm dev
```

Minimum `.env` with no PayPal or Anthropic keys:

```sh
APP_BASE_URL=http://localhost:3000
DATABASE_URL=postgres://counter:counter@localhost:5433/counter
TEST_DATABASE_URL=postgres://counter:counter@localhost:5433/counter_test
SESSION_SECRET=any-random-string-of-at-least-32-characters
DEMO_LOGIN=true
PLATFORM_CLIENT_ID=none       # the server refuses to start without these three;
PLATFORM_CLIENT_SECRET=none   # placeholders are fine until you test checkout
PLATFORM_MERCHANT_ID=none
```

What works without keys: `pnpm test` (PayPal and Claude are stubbed), the root page, product pages, `/llms.txt`, MCP `search_products` and `get_product`, `/feed.json` (empty until products have photos: add them under `seed/photos/<slug>/`), the maker app through the demo login, and the dashboard's charts. Questions and offers fall back to templates (answers from listing fields, a counter at list price). Needs `ANTHROPIC_API_KEY`: listings from voice, model answers and negotiation, both copilots, the Studio agents. Needs a PayPal sandbox Platform app (`PLATFORM_*`, `PAYPAL_WEBHOOK_ID`): checkout, onboarding, tracking, release and refunds; then onboard makers with `pnpm onboard --seller <id>` and run `pnpm seed` without `--local`.

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (DB tests run when `TEST_DATABASE_URL` is set). Real-model and sandbox checks: `pnpm eval:*` (need `ANTHROPIC_API_KEY`) and `pnpm e2e:purchase|release|refund|replay` (sandbox PayPal; a human approves as the sandbox buyer).

Demo data: `pnpm demo:reset [--yes]` before a demo or filming take: removes test orders, offers, drafts, chats and listings made on camera, restores stock; demo makers only, dry run without `--yes`.

Rate limits are per caller (IP + User-Agent). Hosted assistants that call from their vendor's IPs (`Claude-User`, `ChatGPT-User`, `Perplexity-User`) are one caller for all their users, so their per-caller limits are 10× higher.

Schema changes: edit `lib/db/schema.ts`, then `pnpm db:generate` and commit the new file in `drizzle/`.

## Deploy (Render)

`render.yaml` is a Render Blueprint: web service, cron sweep, workflow service and Postgres 17, on paid plans so the service never sleeps and the database outlives the free tier's 30 days.

1. In Render: **New → Blueprint**, pick this repo.
2. Fill the prompted secrets: `PLATFORM_CLIENT_ID`, `PLATFORM_CLIENT_SECRET`, `ANTHROPIC_API_KEY`. `PAYPAL_WEBHOOK_ID` can stay blank until the webhook exists (`pnpm paypal:webhook <url>`).
3. Each deploy runs migrations (`node scripts/migrate.ts`) before starting, and Render waits for `/api/health` to return 200. Pushes to `main` deploy after CI passes.

The database accepts no external connections by default; add your IP under the database's **Access Control** to connect from a laptop (for `pnpm seed`, `demo:reset`, `cost:report`).

## Built during the hackathon

All code in this repo was written Oct 24 – Nov 12, 2026, for this hackathon. Built with Next.js 16, React 19, Drizzle ORM, Postgres, Zod, the Anthropic TypeScript SDK, the MCP TypeScript SDK, AG Studio, shadcn/ui (Base UI), Render (web, cron, Workflows, Postgres) and the PayPal REST APIs. Seed listings were written for the demo; the makers are fictional.

## License

[MIT](LICENSE)

import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { Money } from "@/lib/schemas/common";
import { featuredProducts } from "@/lib/shop/catalog";

// What a judge sees on the root URL (BUILDOUT §8.4): what Counter is and how to try each side.

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const fmt = (m: Money) => (m.currency === "USD" ? `$${m.value} USD` : `${m.value} ${m.currency}`);

const SAMPLE_PROMPT =
  "Find me a handwoven rug from Oaxaca under $200, shipped to the US. Ask the maker how to clean it, then offer a bit less and check out.";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Counter</h1>
        <p className="text-lg">AI agents buy handmade goods directly from the people who make them.</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
          <li>A maker describes a piece in a voice note in their own language; Claude writes the listing and suggests a price.</li>
          <li>Shopping agents search, ask questions, negotiate and check out over MCP.</li>
          <li>The buyer approves every payment on PayPal, which holds the money until the order ships and arrives.</li>
        </ul>
        <p className="text-sm text-muted-foreground">Everything runs on the PayPal sandbox: no real money moves.</p>
      </header>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <TryIt />
      </Suspense>
    </main>
  );
}

async function TryIt() {
  await connection();
  const base = getEnv().APP_BASE_URL;
  const featured = await featuredProducts(getDb());
  return (
    <>
      {featured.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl font-semibold">On Counter now</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {featured.map((p) => (
              <li key={p.productId}>
                <a href={p.url} className="group flex flex-col gap-1.5">
                  {p.photoUrl ? (
                    // Photos are already resized WebP from our own route; next/image adds nothing here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.photoUrl}
                      alt={p.title}
                      className="aspect-square w-full rounded-lg object-cover transition-opacity group-hover:opacity-90"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded-lg bg-muted" />
                  )}
                  <span className="line-clamp-2 text-sm font-medium group-hover:underline">{p.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.maker.name} · {regionNames.of(p.maker.country)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{fmt(p.price)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">Buy as an agent</h2>
        <p>Add Counter to Claude as a custom connector:</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 rounded-lg bg-muted p-3 text-sm break-all">{base}/api/mcp</code>
          <CopyButton value={`${base}/api/mcp`} />
        </div>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li>claude.ai → Settings → Connectors → Add custom connector</li>
          <li>Paste the URL above and choose No sign-in</li>
          <li>Ask, for example: “{SAMPLE_PROMPT}”</li>
          <li>Approve the payment on PayPal with a sandbox buyer account</li>
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">Sell as a maker</h2>
        <p>
          Sign in as one of the demo makers (Mexico, the Philippines, Kenya) to list a piece by voice, see orders and talk to the
          copilot. Best on a phone.
        </p>
        <Link href="/s/login" className={buttonVariants({ className: "self-start" })}>
          Open the maker app
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">For agents and crawlers</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>
            <a href="/llms.txt" className="underline underline-offset-4">/llms.txt</a>: tools, buying steps and limits
          </li>
          <li>
            <a href="/feed.json" className="underline underline-offset-4">/feed.json</a>: every product for sale
          </li>
          <li>
            <code className="break-all">{base}/api/acp/checkout_sessions</code>: Agentic Commerce Protocol checkout
          </li>
        </ul>
      </section>

      <p className="text-sm text-muted-foreground">
        Operator console: <Link href="/ops" className="underline underline-offset-4">/ops</Link> (password from the
        submission notes).
      </p>
    </>
  );
}

import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { sampleProductUrl } from "@/lib/shop/llms";

// What a judge sees on the root URL (BUILDOUT §8.4): what Counter is and how to try each side.

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
  const sample = await sampleProductUrl(getDb());
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold">Buy as an agent</h2>
        <p>Add Counter to Claude as a custom connector:</p>
        <code className="rounded-lg bg-muted p-3 text-sm break-all">{base}/api/mcp</code>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li>claude.ai → Settings → Connectors → Add custom connector</li>
          <li>Paste the URL above and choose No sign-in</li>
          <li>Ask, for example: “{SAMPLE_PROMPT}”</li>
          <li>Approve the payment on PayPal with a sandbox buyer account</li>
        </ol>
        {sample && (
          <p className="text-sm">
            Or browse a{" "}
            <a href={sample} className="underline underline-offset-4">
              sample product page
            </a>
            .
          </p>
        )}
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

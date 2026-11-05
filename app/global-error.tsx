"use client";

import "./globals.css";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-full flex-col">
        <main role="alert" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-6">
          <h1 className="text-2xl font-semibold">Counter didn&apos;t load.</h1>
          <p>Something went wrong on our side. Please try again in a minute.</p>
          <button type="button" onClick={() => retry()} className="self-start rounded-lg border px-4 py-2">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonVariants({ variant: "outline", size: "sm", className: "shrink-0" })}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

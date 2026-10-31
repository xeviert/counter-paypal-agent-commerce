"use client";

import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/i18n";
import type { MessageKey } from "@/lib/i18n/core";

type FieldProps = {
  name: string;
  label: string;
  error?: MessageKey;
  hint?: ReactNode;
};

function Shell({ name, label, error, hint, children }: FieldProps & { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${name}-error`} className="text-xs text-destructive">
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function TextField({ name, label, error, hint, ...props }: FieldProps & ComponentProps<typeof Input>) {
  return (
    <Shell name={name} label={label} error={error} hint={hint}>
      <Input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className="h-11 text-base"
        {...props}
      />
    </Shell>
  );
}

export function TextAreaField({ name, label, error, hint, ...props }: FieldProps & ComponentProps<typeof Textarea>) {
  return (
    <Shell name={name} label={label} error={error} hint={hint}>
      <Textarea
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className="text-base"
        {...props}
      />
    </Shell>
  );
}

export function SelectField({
  name,
  label,
  error,
  hint,
  options,
  ...props
}: FieldProps & ComponentProps<"select"> & { options: { value: string; label: string }[] }) {
  return (
    <Shell name={name} label={label} error={error} hint={hint}>
      <select
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        className="h-11 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function FormError({ error }: { error?: MessageKey }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
      {t(error)}
    </p>
  );
}

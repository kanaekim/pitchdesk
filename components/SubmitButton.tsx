"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  className = "btn",
  formAction,
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} formAction={formAction} name={name} value={value}>
      {pending ? pendingText ?? "Working…" : children}
    </button>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

/** Submit button for the mutation forms: disables itself and dims while the form action is pending. */
export function SubmitButton({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      style={pending ? { ...style, opacity: 0.6, cursor: "default" } : style}
      disabled={pending}
    >
      {children}
    </button>
  );
}

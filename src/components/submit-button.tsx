"use client";
import { useFormStatus } from "react-dom";

// A form button that shows it was pressed: it dims, shows a small spinner and stays disabled
// until the server answers.
export function SubmitButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  const { disabled, children, ...rest } = props;
  return (
    <button {...rest} disabled={disabled || pending} aria-busy={pending || undefined} data-pending={pending ? "" : undefined}>
      {children}
    </button>
  );
}

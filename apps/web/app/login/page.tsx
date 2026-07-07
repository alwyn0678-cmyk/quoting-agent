"use client";

import { use, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  // set by /auth/callback when the code exchange fails (expired / already-used magic link)
  const params = use(searchParams);
  const authError = Array.isArray(params.error) ? params.error[0] ?? null : params.error ?? null;
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
      setMessage(`Magic link sent to ${email}. Check your inbox to sign in.`);
    }
  }

  return (
    <div className="loginwrap">
      <div className="login">
        <div className="lbrand">
          <div className="anchor" aria-hidden>
            ⚓
          </div>
          <b>
            Linkport<span>Forwarders · Quote desk</span>
          </b>
        </div>
        <h1>Reviewer sign-in</h1>
        <p>Sign in with a magic link to review your tenant&apos;s quote requests.</p>
        <form onSubmit={onSubmit}>
        <input
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "sending" || status === "sent"}
        />
        <button type="submit" disabled={status === "sending" || status === "sent"}>
          {status === "sending" ? "Sending…" : "Send magic link"}
        </button>
      </form>
        {message && (
          <div className={`notice ${status === "error" ? "err" : "ok"}`}>{message}</div>
        )}
        {authError && status === "idle" && (
          <div className="notice err">
            That sign-in link expired or was already used. Request a new one above.
          </div>
        )}
      </div>
    </div>
  );
}

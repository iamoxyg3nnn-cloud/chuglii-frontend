import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { FilmStrip, WarningCircle, CheckCircle } from "@phosphor-icons/react";

const EMAIL_ERROR_HINTS: [RegExp, string][] = [
  [/verification email|email service|email provider/i, "This is a server configuration issue. Please contact support for help."],
  [/not found|no user/i, "No account was found with this email. Please check and try again."],
  [/rate limit/i, "You've made too many requests. Please wait a few minutes before trying again."],
];

function emailErrorHint(msg: string): string | null {
  for (const [re, hint] of EMAIL_ERROR_HINTS) {
    if (re.test(msg)) return hint;
  }
  return null;
}

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await resetPassword(email);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-1.5 group mb-8">
            <FilmStrip size={20} weight="duotone" className="text-primary" />
            <span className="font-bold text-xl tracking-tight text-foreground group-hover:text-primary transition-colors">
              VAULT<span className="text-primary">.</span>
            </span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-4">Reset password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            We'll send you a link to reset your password
          </p>
        </div>

        {sent ? (
          <div className="text-center">
            <CheckCircle size={38} weight="duotone" className="text-primary mx-auto mb-4" />
            <p className="text-sm text-foreground font-medium mb-1">Email sent!</p>
            <p className="text-xs text-muted-foreground mb-6">
              Check <strong>{email}</strong> for the reset link.
            </p>
            <Link
              href="/login"
              className="text-sm text-primary hover:underline font-medium"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex flex-col gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
                <div className="flex items-start gap-2">
                  <WarningCircle size={15} weight="duotone" className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
                {emailErrorHint(error) && (
                  <p className="ml-5 text-destructive/70 leading-relaxed">{emailErrorHint(error)}</p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="reset-email" className="text-xs font-medium text-muted-foreground">
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
                className="w-full h-10 bg-secondary border border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 rounded-lg px-3 text-sm outline-none transition-all placeholder:text-muted-foreground/40"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors rounded-lg shadow-xs disabled:opacity-60 cursor-pointer"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>

            <p className="text-center text-xs text-muted-foreground">
              <Link href="/login" className="text-primary hover:underline">
                ← Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// asset-cache-bust: 2026-11-25T2 (poisoned /assets/* immutable entries)

if (typeof window !== "undefined") { (window as unknown as { __chunkBuilds?: Record<string, number> }).__chunkBuilds = { b2: 1 }; }

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, User, LoaderCircle } from "lucide-react";
import { uiFont, ACCENT } from "@/components/map/sidebarTheme";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!identifier.trim() || !password) {
      setError("Enter your username or email, and your password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      router.push("/map");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`${uiFont.className} relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#f5f5f7] px-4 py-10 antialiased`}
    >
      {/* Faint cadastral-grid texture, full page */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.4]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="lot-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#d8d8dd" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lot-grid)" />
      </svg>

      <div className="relative w-full max-w-[380px] animate-[login-in_0.35s_ease-out] rounded-[20px] bg-white p-7 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.12)] sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[12px] text-sm font-bold tracking-wide text-white"
            style={{ background: `linear-gradient(135deg, #6366f1, ${ACCENT})` }}
          >
            OCM
          </div>
          <h1 className="mt-4 text-[20px] font-bold tracking-tight text-[#1d1d1f] sm:text-[21px]">
            Sign in to OCM
          </h1>
          <p className="mt-1 text-[12.5px] text-[#8e8e93]">One Control Map</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
          {error && (
            <div
              role="alert"
              className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700"
            >
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[#1d1d1f]">Username or email</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-[#d8d8dd] px-3 py-3 transition-all focus-within:border-[#4f46e5] focus-within:ring-4 focus-within:ring-[#4f46e5]/10 sm:py-2.5">
              <User size={15} className="flex-shrink-0 text-[#8e8e93]" />
              <input
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="username"
                className="w-full border-0 bg-transparent p-0 text-[15px] text-[#1d1d1f] outline-none placeholder:text-[#c7c7cc] sm:text-[13.5px]"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[#1d1d1f]">Password</span>
            <div className="flex items-center gap-2 rounded-[10px] border border-[#d8d8dd] px-3 py-3 transition-all focus-within:border-[#4f46e5] focus-within:ring-4 focus-within:ring-[#4f46e5]/10 sm:py-2.5">
              <Lock size={15} className="flex-shrink-0 text-[#8e8e93]" />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border-0 bg-transparent p-0 text-[15px] text-[#1d1d1f] outline-none placeholder:text-[#c7c7cc] sm:text-[13.5px]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="flex-shrink-0 border-0 bg-transparent p-0 text-[#8e8e93] hover:text-[#1d1d1f]"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 flex min-h-[46px] items-center justify-center gap-2 rounded-full border-0 py-2.5 text-[14px] font-semibold text-white shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 sm:text-[13.5px]"
            style={{ background: ACCENT }}
          >
            {submitting && <LoaderCircle size={14} className="animate-spin" />}
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11.5px] text-[#8e8e93]">
          Need access? Please contact the administrator.
        </p>
      </div>

      <style>{`
        @keyframes login-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
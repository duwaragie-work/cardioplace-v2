"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

function isEmailValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function AdminSignInPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const emailIsValid = useMemo(() => isEmailValid(email.trim()), [email]);

  useEffect(() => {
    if (!isLoading && user?.roles?.includes("SUPER_ADMIN")) {
      router.replace("/dashboard");
    }
  }, [isLoading, user, router]);

  async function handleSendMagicLink() {
    if (!emailIsValid || isSending) return;
    setErrorMessage("");
    setStatusMessage("");
    setIsSending(true);
    try {
      const res = await fetch(`${API_URL}/api/v2/auth/magic-link/send`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Something went wrong.");
      setMagicLinkSent(true);
      setStatusMessage("Magic link sent. Check your email to sign in.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to send magic link.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-[#f8fafc]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 border border-[#e5e7eb]">
        <h1 className="text-2xl font-bold text-[#170c1d] mb-2">Cardioplace Admin</h1>
        <p className="text-sm text-[#4b5563] mb-6">
          Provider and care-team console. SUPER_ADMIN access required.
        </p>

        <label className="block text-xs font-semibold text-[#171717] mb-2">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@practice.org"
          autoComplete="email"
          disabled={magicLinkSent}
          className="w-full h-11 px-4 bg-white border border-[#d1d5db] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent"
        />

        {!magicLinkSent ? (
          <button
            onClick={handleSendMagicLink}
            disabled={!emailIsValid || isSending}
            className="w-full mt-4 h-11 bg-[#7B00E0] rounded-lg font-semibold text-white text-sm hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? "Sending..." : "Send magic link"}
          </button>
        ) : (
          <div className="mt-4 p-4 bg-[#f5f3ff] border border-[#e5d9f2] rounded-lg text-center">
            <p className="text-[#7B00E0] font-semibold text-sm mb-1">Check your email</p>
            <p className="text-[#6b7280] text-xs">
              We sent a sign-in link. Tap it to log in.
            </p>
            <button
              type="button"
              onClick={() => {
                setMagicLinkSent(false);
                setStatusMessage("");
              }}
              className="mt-3 text-[#7B00E0] text-xs font-medium hover:underline"
            >
              Send another link
            </button>
          </div>
        )}

        {(statusMessage || errorMessage) && (
          <p
            role="status"
            className={`mt-3 text-xs ${errorMessage ? "text-red-500" : "text-green-600"}`}
          >
            {errorMessage || statusMessage}
          </p>
        )}
      </div>
    </main>
  );
}

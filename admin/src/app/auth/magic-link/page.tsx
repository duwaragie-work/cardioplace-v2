"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// Bridges a cross-origin admin sign-in into admin auth state. Two callers, both
// now TOKENLESS (PHI audit 1.1 / 1.2 / V-11):
//   1. Backend magic-link verify (auth.controller.ts) — a SUPER_ADMIN who
//      clicked a link from email. The redirect now sets HttpOnly cookies and
//      lands here with NO tokens in the URL.
//   2. Patient sign-in bridge (frontend/src/app/sign-in/page.tsx) — an admin who
//      authenticated on the patient app; the OTP verify already set the
//      admin-scoped HttpOnly cookies.
// Either way we authenticate via the COOKIE: AuthProvider's mount rehydrate
// calls POST /auth/refresh with credentials:'include'. No token is read from the
// URL (so nothing lands in the CloudFront/S3 access log); this page only reads
// `?error=` and routes once the session resolves.
function MagicLinkHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const [error, setError] = useState("");

  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (errorParam) {
      setError(
        errorParam === "expired"
          ? "This sign-in link has expired or already been used."
          : "Something went wrong. Please try again.",
      );
      return;
    }
    // Wait for the cookie-based mount rehydrate to settle.
    if (isLoading) return;
    if (!user) {
      setError("This sign-in link is invalid or has expired.");
      return;
    }
    // Full page navigation so the proxy reads the freshly-established cookie.
    window.location.href = "/dashboard";
  }, [errorParam, user, isLoading]);

  if (!error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#7B00E0] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg text-[#374151]">Signing you in...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="text-center max-w-md">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
        >
          <span className="text-2xl" style={{ color: 'var(--brand-alert-red-text)' }}>!</span>
        </div>
        <h2 className="text-xl font-bold text-[#170c1d] mb-2">Link expired or invalid</h2>
        <p className="text-[#6b7280] mb-6">{error}</p>
        <button
          onClick={() => router.push("/sign-in")}
          className="px-8 py-3 bg-[#7B00E0] text-white rounded-full font-semibold hover:bg-[#6600BC] transition-colors cursor-pointer"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="w-12 h-12 border-4 border-[#7B00E0] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MagicLinkHandler />
    </Suspense>
  );
}

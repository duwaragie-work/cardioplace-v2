"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { shouldShowOnboardingForUser } from "@/lib/onboarding";

// PHI audit 1.1 / V-11 — the backend used to hand the session over as
// `?accessToken=…&refreshToken=…&email=…&name=…` in this URL, which CloudFront/S3
// would log verbatim. Those params are gone. The backend now sets the session as
// HttpOnly cookies and redirects here TOKENLESS; the auth-context's mount-time
// rehydrate (which no longer skips this route, since there is no accessToken
// param) calls POST /auth/refresh with credentials:'include' to establish the
// session from those cookies. This page only reads `?error=` and routes once the
// session resolves — no credential is ever read from, or left in, the URL.
function MagicLinkHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [error, setError] = useState("");

  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (errorParam) {
      setError(
        errorParam === "expired"
          ? "This magic link has expired or already been used."
          : "Something went wrong. Please try again.",
      );
      return;
    }
    // Wait for the cookie-based rehydrate to settle before deciding.
    if (isLoading) return;
    if (!user) {
      setError("This magic link is invalid or has expired.");
      return;
    }
    const needsOnboarding = shouldShowOnboardingForUser({
      userId: user.id,
      onboardingStatus: user.onboardingStatus,
      onboardingRequiredHint: user.onboardingRequired,
    });
    // Full navigation so proxy.ts / the destination reads the freshly-set cookie.
    window.location.href = needsOnboarding ? "/onboarding" : "/dashboard";
  }, [errorParam, user, isLoading, router]);

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

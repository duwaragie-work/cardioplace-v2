"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, type AdminAuthResponse } from "@/lib/auth-context";

// Bridges sign-in tokens passed via URL params into admin auth state.
// Two callers redirect here:
//   1. Backend magic-link verify (auth.controller.ts) — for SUPER_ADMIN users
//      who clicked a magic link from email.
//   2. Patient sign-in (frontend/src/app/sign-in/page.tsx) — when an admin
//      user authenticated on the patient app, so they don't have to sign in
//      twice across origins.
function MagicLinkHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(true);
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const errorParam = searchParams.get("error");
    if (errorParam) {
      setError(
        errorParam === "expired"
          ? "This sign-in link has expired or already been used."
          : "Something went wrong. Please try again."
      );
      setProcessing(false);
      return;
    }

    const accessToken = searchParams.get("accessToken");
    const refreshToken = searchParams.get("refreshToken");
    const userId = searchParams.get("userId");

    if (!accessToken || !userId) {
      setError("Invalid sign-in link.");
      setProcessing(false);
      return;
    }

    const authResponse: AdminAuthResponse = {
      accessToken,
      refreshToken: refreshToken ?? undefined,
      userId,
      email: searchParams.get("email") || undefined,
      name: searchParams.get("name") || undefined,
      roles: searchParams.get("roles")?.split(",").filter(Boolean) || [],
    };

    login(authResponse);

    // Full page navigation so the proxy reads the freshly-set cookie.
    window.location.href = "/dashboard";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (processing) {
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

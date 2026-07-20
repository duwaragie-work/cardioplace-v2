"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, type AdminAuthResponse } from "@/lib/auth-context";

// Bridges a cross-origin admin sign-in into admin auth state. Two callers:
//   1. Backend magic-link verify (auth.controller.ts) — a SUPER_ADMIN who
//      clicked a link from email; still arrives with tokens in the URL (that's
//      audit finding 1.1, a backend-owned fix). Handled by the TOKEN path.
//   2. Patient sign-in (frontend/src/app/sign-in/page.tsx) — an admin who
//      authenticated on the patient app. As of 1.2 this arrives with NO tokens
//      in the URL; the OTP verify already set the admin-scoped HttpOnly
//      cookies, so we authenticate via the COOKIE path (AuthProvider's mount
//      rehydrate calls /auth/refresh with that cookie).
function MagicLinkHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, user, isLoading } = useAuth();
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(true);
  // 'token'  → tokens present in the URL (legacy email flow)
  // 'cookie' → no tokens; wait for the mount rehydrate to authenticate
  const [flow, setFlow] = useState<"token" | "cookie">("token");
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

    // No tokens in the URL → cookie bridge (1.2). Do NOT error here; the
    // AuthProvider's mount rehydrate is already refreshing from the HttpOnly
    // cookie. The effect below routes once that resolves.
    if (!accessToken || !userId) {
      setFlow("cookie");
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

  // Cookie bridge (1.2): once the mount rehydrate settles, route on the result.
  // A live session → dashboard; nothing → the same "invalid/expired" UI the
  // token path shows (so a stale bridge doesn't spin forever).
  useEffect(() => {
    if (flow !== "cookie" || isLoading) return;
    if (user) {
      window.location.href = "/dashboard";
    } else {
      setError("This sign-in link is invalid or has expired.");
      setProcessing(false);
    }
  }, [flow, isLoading, user]);

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

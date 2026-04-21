"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth, type OtpVerifyResponse } from "@/lib/auth-context";
import { Suspense } from "react";

function MagicLinkHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(true);
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    // Check for error from backend redirect
    const errorParam = searchParams.get("error");
    if (errorParam) {
      setError(
        errorParam === "expired"
          ? "This magic link has expired or already been used."
          : "Something went wrong. Please try again."
      );
      setProcessing(false);
      return;
    }

    // Read tokens from URL params (set by backend redirect)
    const accessToken = searchParams.get("accessToken");
    const refreshToken = searchParams.get("refreshToken");
    const userId = searchParams.get("userId");

    if (!accessToken || !userId) {
      setError("Invalid magic link.");
      setProcessing(false);
      return;
    }

    // Build the auth response from URL params
    const authResponse: OtpVerifyResponse = {
      accessToken,
      refreshToken: refreshToken ?? undefined,
      userId,
      email: searchParams.get("email") || undefined,
      name: searchParams.get("name") || undefined,
      roles: searchParams.get("roles")?.split(",").filter(Boolean) || [],
      login_method: searchParams.get("login_method") || "magic_link",
      onboarding_required: searchParams.get("onboarding_required") === "true",
    };

    login(authResponse);

    // Full page navigation to ensure auth state is read from localStorage
    const dest = authResponse.onboarding_required
      ? "/onboarding"
      : "/dashboard";
    window.location.href = dest;
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
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">!</span>
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

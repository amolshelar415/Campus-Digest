"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setAuthToken, triggerPollNow } from "@/lib/api";

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    // Backend sends: /auth/callback?token=<JWT>
    const token = params.get("token") || params.get("access_token");
    const error = params.get("error");

    if (error) {
      console.error("[Auth] OAuth error:", error);
      router.replace("/?auth_error=" + encodeURIComponent(error));
      return;
    }

    if (token) {
      // Store token — this also fires the storage event that page.tsx listens to
      setAuthToken(token);
      // Kick off Gmail sync immediately in background (don't await)
      triggerPollNow().catch(console.error);
      // Redirect to dashboard
      router.replace("/");
      return;
    }

    // No token in URL params — shouldn't happen, redirect home
    router.replace("/");
  }, [params, router]);

  return (
    <div
      className="h-screen w-full flex items-center justify-center"
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, sans-serif",
        background: "#F5F5F7",
      }}
    >
      <div className="flex flex-col items-center gap-4">
        {/* Logo */}
        <div
          style={{ background: "linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
          className="h-14 w-14 rounded-[16px] flex items-center justify-center shadow-lg animate-pulse"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
              fill="white"
            />
          </svg>
        </div>

        {/* Text */}
        <div className="text-center">
          <div className="text-[16px] font-semibold text-[#1D1D1F]">Signing you in…</div>
          <div className="text-[12px] text-[#86868B] mt-1">
            Syncing your college Gmail
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mt-1">
          {[0, 0.2, 0.4].map((delay, i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{
                background: "#0A72E8",
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-full flex items-center justify-center bg-[#F5F5F7]">
          <div className="text-[14px] text-[#86868B]">Loading…</div>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}

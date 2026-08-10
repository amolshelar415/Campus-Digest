"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setAuthToken } from "@/lib/api";

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token") || params.get("access_token");
    const error = params.get("error");

    if (error) {
      console.error("[Auth] OAuth error:", error);
      router.replace("/?auth_error=" + encodeURIComponent(error));
      return;
    }

    if (token) {
      setAuthToken(token);
      router.replace("/");
      return;
    }

    // No token in URL — the backend may have set it as a cookie redirect.
    // Try forwarding the full callback URL to the backend.
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").replace(/\/$/, "");
    const qs = params.toString();
    if (qs) {
      // Redirect to backend callback directly — backend will redirect back with token
      window.location.href = `${apiUrl}/auth/callback?${qs}`;
    } else {
      router.replace("/");
    }
  }, [params, router]);

  return (
    <div className="h-screen w-full flex items-center justify-center"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, sans-serif", background: "#F5F5F7" }}>
      <div className="flex flex-col items-center gap-4">
        <div style={{ background: "linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
          className="h-12 w-12 rounded-[14px] flex items-center justify-center shadow-lg animate-pulse">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
              fill="white" strokeWidth="0" />
          </svg>
        </div>
        <div className="text-[15px] font-semibold text-[#1D1D1F]">Signing you in…</div>
        <div className="text-[12px] text-[#86868B]">Campus Digest</div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-full flex items-center justify-center bg-[#F5F5F7]">
        <div className="text-[14px] text-[#86868B]">Loading…</div>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}

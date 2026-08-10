"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setAuthToken } from "@/lib/api";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      setAuthToken(token);
      router.push("/");
    } else {
      router.push("/");
    }
  }, [router, searchParams]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
      <p className="text-sm font-medium">Completing sign in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-50 text-gray-700">
      <Suspense fallback={<p className="text-sm">Loading...</p>}>
        <AuthCallbackContent />
      </Suspense>
    </div>
  );
}


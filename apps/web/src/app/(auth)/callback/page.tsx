'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { completeSignIn } from '@/lib/api';

/**
 * Post-OAuth landing page: exchanges the refresh cookie set by the API
 * callback for an access token, then enters the app.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const signedIn = await completeSignIn();
      router.replace(signedIn ? '/dashboard' : '/login?error=signin_failed');
    })();
  }, [router]);

  return (
    <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">Signing you in and connecting your workspace…</p>
    </div>
  );
}

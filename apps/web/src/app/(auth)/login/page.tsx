'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@company-brain/ui';
import { Loader2 } from 'lucide-react';
import { GOOGLE_SIGN_IN_URL } from '@/lib/api';

function GoogleMark() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.8-.2-2.6H12v4.9h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-9Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1A12 12 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1Z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8L20 3.1A12 12 0 0 0 1.2 6.6l4.1 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"
      />
    </svg>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [redirecting, setRedirecting] = useState(false);
  const error = searchParams.get('error');

  function signIn() {
    setRedirecting(true);
    window.location.href = GOOGLE_SIGN_IN_URL;
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Welcome to Company Brain</CardTitle>
        <CardDescription>
          Sign in with your Google account — your workspace connects and starts synchronizing
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-500">
            {decodeURIComponent(error)}
          </p>
        )}
        <Button className="w-full" onClick={signIn} disabled={redirecting}>
          {redirecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleMark />}
          Continue with Google
        </Button>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

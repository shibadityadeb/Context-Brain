'use client';

import Image from 'next/image';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@company-brain/ui';
import { GOOGLE_SIGN_IN_URL } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { NeuralCanvas } from '@/components/auth/neural-canvas';

function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left — animated brain */}
      <div className="relative hidden overflow-hidden bg-[#0a0a12] lg:block">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 120% at 20% 10%, rgba(99,102,241,0.28), transparent 55%), radial-gradient(100% 100% at 90% 90%, rgba(168,85,247,0.25), transparent 55%)',
          }}
        />
        <NeuralCanvas />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Company Brain" width={36} height={36} priority />
            <span className="font-semibold">Company Brain</span>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-md"
          >
            <h1 className="text-4xl font-semibold leading-tight tracking-tight">
              The AI that remembers everything your company knows.
            </h1>
            <p className="mt-4 text-white/70">
              Every document, meeting and decision — connected, understood and instantly recallable.
              One question away.
            </p>
          </motion.div>
          <div className="flex items-center gap-6 text-xs text-white/50">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> SOC 2 aligned
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Encrypted at rest
            </span>
          </div>
        </div>
      </div>

      {/* Right — sign in */}
      <div className="relative flex items-center justify-center p-6">
        <div className="absolute right-6 top-6">
          <ThemeToggle />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Image src="/logo.png" alt="Company Brain" width={32} height={32} />
            <span className="font-semibold">Company Brain</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with Google. Your workspace connects and starts synchronizing automatically — no
            setup required.
          </p>

          {error && (
            <p className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {decodeURIComponent(error)}
            </p>
          )}

          <Button
            className="mt-6 h-11 w-full gap-2.5 text-sm"
            variant="outline"
            onClick={signIn}
            disabled={redirecting}
          >
            {redirecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />}
            Continue with Google
          </Button>

          <div className="mt-6 space-y-2 text-xs text-muted-foreground">
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              We never post or send email on your behalf.
            </p>
            <p className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-success" />
              Access tokens are encrypted; you can disconnect anytime.
            </p>
          </div>

          <p className="mt-10 text-center text-xs text-muted-foreground">
            By continuing you agree to the Terms and acknowledge the Privacy Policy.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

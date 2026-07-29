import type { Metadata } from 'next';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';

export const metadata: Metadata = { title: 'Set up your workspace' };

/**
 * Post-sign-in onboarding: discover an existing workspace for the user's
 * verified email domain and join it, or create a new one. Lives outside the
 * app shell so the app-area workspace guard can safely redirect here.
 */
export default function OnboardingPage() {
  return <OnboardingFlow />;
}

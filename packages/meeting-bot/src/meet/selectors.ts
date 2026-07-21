/**
 * A single catalog of resilient Google Meet selectors, each expressed as an
 * ordered list of fallbacks that prefer accessibility labels / text over
 * brittle generated attributes. Kept in one place so DOM drift is a one-file
 * fix rather than a hunt across the codebase.
 */
export const MeetSelectors = {
  /** Pre-join prompts to dismiss (device warnings, cookie/account nags). */
  dismissDialogs: [
    'button:has-text("Continue without microphone and camera")',
    'button:has-text("Continue without microphone")',
    'button:has-text("Dismiss")',
    'button:has-text("Got it")',
    'button[aria-label="Close"]',
  ],

  /** Anonymous "Your name" field on the pre-join screen. */
  nameInput: [
    'input[aria-label="Your name"]',
    'input[placeholder="Your name"]',
    'input[type="text"]',
  ],

  /** Toggles labelled "Turn off …" only while the device is currently ON. */
  micOff: ['button[aria-label="Turn off microphone"]', 'div[aria-label="Turn off microphone"]'],
  cameraOff: ['button[aria-label="Turn off camera"]', 'div[aria-label="Turn off camera"]'],

  /** The join / ask-to-join action. */
  join: [
    'button:has-text("Ask to join")',
    'button:has-text("Join now")',
    'span:has-text("Ask to join")',
    'span:has-text("Join now")',
  ],

  /** Present once actually in the call (the meeting toolbar). */
  inCall: [
    'button[aria-label="Leave call"]',
    'button[aria-label*="Leave call"]',
    '[aria-label="Chat with everyone"]',
    'button[aria-label="Show everyone"]',
  ],

  /** The host denied / no one answered the request to join. */
  denied: [
    "text=You can't join this call",
    'text=Someone in the call denied your request',
    'text=No one responded to your request',
  ],

  /** The bot was removed, or the whole meeting was ended by the host. */
  removedOrEnded: [
    'text=You have been removed from the meeting',
    'text=You were removed from the meeting',
    'text=The meeting has ended',
    'text=This call ended',
    'text=Return to home screen',
    'text=You left the meeting',
  ],

  /** Hang up. */
  leave: ['button[aria-label="Leave call"]', 'button[aria-label*="Leave call"]'],

  /** Open the People panel so participant names are in the DOM. */
  peopleButton: [
    'button[aria-label="Show everyone"]',
    'button[aria-label="People"]',
    'button[aria-label*="participant"]',
  ],

  /** Rows in the People panel; innerText is the participant's display name. */
  participantRows: ['div[role="listitem"]', '[aria-label="Participants"] [role="listitem"]'],
} as const;

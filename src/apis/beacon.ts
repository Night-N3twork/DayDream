export function trackEvent(
  name: string,
  params: Record<string, unknown> = {},
): void {
  try {
    type TagWindow = Window & {
      gtag?: (command: string, name: string, params: Record<string, unknown>) => void;
    };
    // Internal settings/newtab pages share the shell's browser session. A
    // cross-origin parent is inaccessible and safely falls through the catch.
    const gtag = (window as TagWindow).gtag ?? (window.parent as TagWindow).gtag;
    // Internal events use colons/hyphens; GA event names allow only letters,
    // numbers and underscores, start with a letter, and are at most 40 chars.
    let eventName = name.replace(/[^a-zA-Z0-9_]/g, "_");
    if (!/^[a-zA-Z]/.test(eventName)) eventName = `app_${eventName}`;
    gtag?.("event", eventName.slice(0, 40), params);
  } catch {
    /* telemetry must never break app */
  }
}

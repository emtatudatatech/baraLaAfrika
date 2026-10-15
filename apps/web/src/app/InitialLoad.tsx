/**
 * Shown for the few milliseconds before the first route module has loaded. The themed page
 * background is already painted by index.html, so nothing else is drawn (no flash of a
 * spinner); declaring it also tells React Router the blank moment is intended.
 */
export function InitialLoad() {
  return null;
}

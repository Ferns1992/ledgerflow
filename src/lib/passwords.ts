/**
 * Password policy, mirroring the server's `passwordProblems()`.
 *
 * The server is authoritative — it re-checks every password it accepts. This
 * exists so the UI can explain the rule before a request is sent, rather than
 * rejecting a 10-character password after the user has filled in a form.
 */
export function passwordProblems(plain: string): string[] {
  const issues: string[] = [];
  if (plain.length < 10) issues.push('at least 10 characters');
  if (!/[a-z]/.test(plain)) issues.push('a lowercase letter');
  if (!/[A-Z]/.test(plain)) issues.push('an uppercase letter');
  if (!/[0-9]/.test(plain)) issues.push('a digit');
  return issues;
}

/** Rule text for form hints, generated from the same list so it cannot drift. */
export function passwordHint(): string {
  return `At least 10 characters, including ${passwordProblems('x').join(', ').replace(/^a /, 'an ')}.`;
}

/** Resume ids become a separate argv element after vendor flags. Reject
 *  flag-shaped or otherwise unsafe tokens so a poisoned `.kala/state.yaml`
 *  cannot flip Claude/Cursor/Grok/agy option parsing. Allowlist only. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

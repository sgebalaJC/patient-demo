/**
 * errorMessage — read a human string from any thrown value.
 *
 * Use in `catch (error: unknown)` blocks instead of `(error: any).message`,
 * which silently degrades when the thrown value isn't an Error (string,
 * Firebase error code object, plain object). This helper lets us keep
 * `unknown` everywhere so TypeScript flags the dangerous shape access.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(err);
}

/**
 * errorCode — pick a Firebase / fetch error code if present, otherwise null.
 * Useful for switch-on-code error UI without `as any`.
 */
export function errorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

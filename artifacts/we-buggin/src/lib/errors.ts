export function errMessage(e: unknown, fallback = 'Something went wrong. Try again.') {
  const x = e as { data?: { error?: string } | null; message?: string };
  return x?.data?.error ?? x?.message ?? fallback;
}
export const errStatus = (e: unknown) => (e as { status?: number })?.status;

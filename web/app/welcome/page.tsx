import { redirect } from 'next/navigation';
import { normalizeUsername } from '@/lib/username';

interface Props {
  searchParams: Promise<{ u?: string | string[] }>;
}

/** Old post-registration URL. The success view now lives in the claim wizard. */
export default async function WelcomeRedirect({ searchParams }: Props) {
  // A repeated ?u= arrives as an array; only a single value is a username.
  const { u } = await searchParams;
  const username = typeof u === 'string' && u ? normalizeUsername(u) : undefined;
  redirect(username ? `/claim/${encodeURIComponent(username)}?done=1` : '/claim');
}

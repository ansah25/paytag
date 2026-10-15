import { redirect } from 'next/navigation';
import { normalizeUsername } from '@/lib/username';

interface Props {
  searchParams: { u?: string };
}

/** Old post-registration URL. The success view now lives in the claim wizard. */
export default function WelcomeRedirect({ searchParams }: Props) {
  const username = searchParams.u ? normalizeUsername(searchParams.u) : undefined;
  redirect(username ? `/claim/${encodeURIComponent(username)}?done=1` : '/claim');
}

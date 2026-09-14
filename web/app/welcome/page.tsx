import { redirect } from 'next/navigation';

interface Props {
  searchParams: { u?: string };
}

/** Old post-registration URL. The success view now lives in the claim wizard. */
export default function WelcomeRedirect({ searchParams }: Props) {
  const username = searchParams.u?.trim().toLowerCase();
  redirect(username ? `/claim/${encodeURIComponent(username)}?done=1` : '/claim');
}

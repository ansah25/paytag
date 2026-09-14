import { ClaimWizard } from '@/components/claim/ClaimWizard';

interface Props {
  params: { username: string };
}

// ?done=1 (set after registering, and by the old /welcome redirect) is not
// trusted here: the wizard shows the success view only when /me confirms the
// signed-in wallet owns this name.
export default function ClaimPage({ params }: Props) {
  const username = decodeURIComponent(params.username);
  return <ClaimWizard key={username} username={username} />;
}

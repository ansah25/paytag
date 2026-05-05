import { redirect } from 'next/navigation';

interface Props {
  params: { username: string };
}

export default function LegacyPayRedirect({ params }: Props) {
  redirect(`/${params.username}`);
}

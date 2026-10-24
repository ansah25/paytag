import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ username: string }>;
}

export default async function LegacyPayRedirect({ params }: Props) {
  redirect(`/${(await params).username}`);
}

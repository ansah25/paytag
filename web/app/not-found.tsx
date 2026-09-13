import { MessageScreen } from '@/components/MessageScreen';

export default function NotFound() {
  return (
    <MessageScreen
      kicker="404"
      tone="muted"
      title="There’s nothing at this address."
      copy="The page may have moved, or the link was mistyped. Usernames live at paytag.dev/yourname."
      primary={{ label: 'Send to a name', href: '/send' }}
    />
  );
}

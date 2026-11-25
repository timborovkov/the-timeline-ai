import Link from 'next/link';

export function UpdateFollowUp({ digestId }: { digestId: string }) {
  return (
    <Link
      href={`/app/chat?update=${encodeURIComponent(digestId)}`}
      className="inline-block text-sm underline underline-offset-4"
    >
      Ask a follow-up
    </Link>
  );
}

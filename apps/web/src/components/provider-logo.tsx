import Image from 'next/image';

import { cn } from '@/lib/utils';

const SIZE = {
  xs: { box: 'size-6 p-0.5', img: 16, imgClass: 'size-4' },
  sm: { box: 'size-7 p-1', img: 18, imgClass: 'size-[18px]' },
  md: { box: 'size-12 p-2', img: 28, imgClass: 'size-7' },
  lg: { box: 'size-14 p-2.5 sm:size-16 sm:p-3', img: 40, imgClass: 'size-8 sm:size-10' },
} as const;

export function ProviderLogo({
  src,
  size = 'sm',
  className,
  title,
}: {
  src: string;
  size?: keyof typeof SIZE;
  className?: string;
  title?: string;
}) {
  const spec = SIZE[size];
  return (
    <span
      title={title}
      className={cn(
        'grid shrink-0 place-items-center rounded-sm border border-border bg-white',
        spec.box,
        className,
      )}
    >
      <Image
        src={src}
        alt=""
        width={spec.img}
        height={spec.img}
        unoptimized={src.endsWith('.svg')}
        loading="eager"
        draggable={false}
        className={cn('object-contain', spec.imgClass)}
      />
    </span>
  );
}

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type SaveState = 'idle' | 'saving' | 'saved';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

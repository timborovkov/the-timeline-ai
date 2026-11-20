import styles from '@/app/(landing)/home.module.css';

export function observeHomePanels(panels: HTMLElement[]): () => void {
  const visibleClass = styles.visible;
  if (!visibleClass) return () => undefined;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const panel = entry.target as HTMLElement;
        if (entry.isIntersecting) panel.dataset.homeEntered = '';
        panel.classList.toggle(visibleClass, entry.isIntersecting);
      }
    },
    { rootMargin: '-4% 0px -4% 0px', threshold: 0.06 },
  );
  for (const panel of panels) observer.observe(panel);
  return () => {
    observer.disconnect();
    for (const panel of panels) panel.classList.remove(visibleClass);
  };
}

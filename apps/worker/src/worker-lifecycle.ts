interface Consumer {
  close(): Promise<void>;
}

interface WorkerRegistration {
  name: string;
  start(): Consumer | null;
  closeQueue(): Promise<void>;
  schedule?(): Promise<void>;
}

export async function startWorkerGroup(registrations: readonly WorkerRegistration[]) {
  const started = registrations.map((registration) => ({
    ...registration,
    consumer: registration.start(),
  }));
  // All consumers must be started before catchup schedulers enqueue work.
  for (const registration of started) await registration.schedule?.();
  return {
    activeNames: started.filter(({ consumer }) => consumer !== null).map(({ name }) => name),
    async close(): Promise<void> {
      // Consumers may enqueue downstream jobs while draining, so producers close last.
      await Promise.all(started.flatMap(({ consumer }) => (consumer ? [consumer.close()] : [])));
      for (const registration of started) await registration.closeQueue();
    },
  };
}

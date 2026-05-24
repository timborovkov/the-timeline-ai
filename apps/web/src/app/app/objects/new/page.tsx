import { NarrowContainer } from '@/components/narrow-container';
import { NewObjectForm } from '@/components/objects/new-object-form';

export default function NewObjectPage() {
  return (
    <NarrowContainer>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Objects</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">New object</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a workspace object. You can edit every field on the object page afterwards.
        </p>
      </header>
      <NewObjectForm />
    </NarrowContainer>
  );
}

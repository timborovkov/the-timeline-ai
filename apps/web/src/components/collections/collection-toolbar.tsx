import { CollectionToolbar as CollectionToolbarRoot } from '@/components/collections/collection-toolbar-client';
import {
  CollectionToolbarActions,
  CollectionToolbarClearAll,
  CollectionToolbarCount,
  CollectionToolbarFilters,
  CollectionToolbarSearch,
  CollectionToolbarView,
} from '@/components/collections/collection-toolbar-slots';

export const CollectionToolbar = Object.assign(CollectionToolbarRoot, {
  Search: CollectionToolbarSearch,
  Count: CollectionToolbarCount,
  Filters: CollectionToolbarFilters,
  ClearAll: CollectionToolbarClearAll,
  View: CollectionToolbarView,
  Actions: CollectionToolbarActions,
});

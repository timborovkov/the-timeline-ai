import { createCollectionSlot } from '@/components/collections/collection-slot';

export const CollectionToolbarSearch = createCollectionSlot('search');
export const CollectionToolbarCount = createCollectionSlot('count');
export const CollectionToolbarFilters = createCollectionSlot('filters');
export const CollectionToolbarClearAll = createCollectionSlot('clearAll');
export const CollectionToolbarView = createCollectionSlot('view');
export const CollectionToolbarActions = createCollectionSlot('actions');

export const COLLECTION_TOOLBAR_SLOTS = {
  search: CollectionToolbarSearch,
  count: CollectionToolbarCount,
  filters: CollectionToolbarFilters,
  clearAll: CollectionToolbarClearAll,
  view: CollectionToolbarView,
  actions: CollectionToolbarActions,
};

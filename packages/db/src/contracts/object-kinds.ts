export const IDENTITY_FACET_KINDS = [
  'email',
  'phone',
  'telegram',
  'slack',
  'github',
  'timeline_user',
  'other',
] as const;
export type IdentityFacetKind = (typeof IDENTITY_FACET_KINDS)[number];

export const RELATIONSHIP_KINDS = [
  'parent',
  'child',
  'related',
  'blocks',
  'blocked_by',
  'duplicate_of',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

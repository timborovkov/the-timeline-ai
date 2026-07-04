import { describe, expect, it } from 'vitest';

import {
  buildAssociationDedupeKey,
  buildEvidenceDedupeKey,
  buildOutputDedupeKey,
  mostRestrictiveVisibility,
  validateSourceRefs,
  visibilityAtOrBelowFloor,
} from '#src/reconciliation/index.js';

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('reconciliation domain helpers', () => {
  it('prevents outputs from becoming more visible than their source floor', () => {
    expect(
      visibilityAtOrBelowFloor(
        { visibility: 'team' },
        { visibility: 'private', visibilityOwnerUserId: USER_A },
      ),
    ).toBe(false);

    expect(
      visibilityAtOrBelowFloor(
        { visibility: 'private', visibilityOwnerUserId: USER_A },
        { visibility: 'private', visibilityOwnerUserId: USER_A },
      ),
    ).toBe(true);

    expect(
      visibilityAtOrBelowFloor(
        { visibility: 'private', visibilityOwnerUserId: USER_B },
        { visibility: 'private', visibilityOwnerUserId: USER_A },
      ),
    ).toBe(false);

    expect(
      visibilityAtOrBelowFloor(
        { visibility: 'private', visibilityOwnerUserId: USER_A },
        { visibility: 'specific_users', visibilityUserIds: [USER_A, USER_B] },
      ),
    ).toBe(true);
  });

  it('derives the most restrictive visibility floor from mixed evidence', () => {
    expect(
      mostRestrictiveVisibility([
        { visibility: 'team' },
        { visibility: 'specific_users', visibilityUserIds: [USER_A] },
      ]),
    ).toBe('specific_users');

    expect(
      mostRestrictiveVisibility([
        { visibility: 'team' },
        { visibility: 'private', visibilityOwnerUserId: USER_A },
        { visibility: 'specific_users', visibilityUserIds: [USER_A, USER_B] },
      ]),
    ).toBe('private');
  });

  it('builds stable replay-safe dedupe keys', () => {
    const evidenceKey = buildEvidenceDedupeKey({
      teamId: 'team-1',
      source: 'email',
      rawEventId: 'raw-1',
      sourcePayloadDigest: 'sha256:abc',
      normalizerVersion: 'reconcile-normalize-2026-06',
    });

    expect(evidenceKey).toMatch(/^reconcile:evidence:[a-f0-9]{32}$/);
    expect(evidenceKey).toBe(
      buildEvidenceDedupeKey({
        rawEventId: 'raw-1',
        normalizerVersion: 'reconcile-normalize-2026-06',
        source: 'email',
        sourcePayloadDigest: 'sha256:abc',
        teamId: 'team-1',
      }),
    );

    expect(
      buildAssociationDedupeKey({
        teamId: 'team-1',
        clusterId: 'cluster-1',
        evidenceId: 'evidence-1',
        role: 'discussion',
        associationSource: 'hard_anchor',
        associationPolicyVersion: 'association-policy-1',
      }),
    ).toMatch(/^reconcile:association:[a-f0-9]{32}$/);
  });

  it('normalizes source-ref ordering for output dedupe keys', () => {
    const refs = [
      { source: 'sentry', rawEventId: 'raw-sentry', evidenceId: 'ev-sentry' },
      { source: 'email', rawEventId: 'raw-email', evidenceId: 'ev-email' },
    ];

    expect(
      buildOutputDedupeKey({
        teamId: 'team-1',
        clusterId: 'cluster-1',
        targetKind: 'object_relationship',
        operation: 'create',
        targetId: null,
        sourceRefs: refs,
        authorityPolicyVersion: 'authority-1',
        plannerVersion: 'planner-1',
      }),
    ).toBe(
      buildOutputDedupeKey({
        teamId: 'team-1',
        clusterId: 'cluster-1',
        targetKind: 'object_relationship',
        operation: 'create',
        targetId: null,
        sourceRefs: [...refs].reverse(),
        authorityPolicyVersion: 'authority-1',
        plannerVersion: 'planner-1',
      }),
    );
  });

  it('keeps output dedupe keys stable when evidence lineage rows change', () => {
    const base = {
      teamId: 'team-1',
      clusterId: 'cluster-1',
      targetKind: 'cluster_identity',
      operation: 'link',
      targetId: null,
      targetIdentity: 'cluster-1:raw-1:blocker:hard_anchor',
      authorityPolicyVersion: 'authority-1',
      plannerVersion: 'planner-1',
    };

    expect(
      buildOutputDedupeKey({
        ...base,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-1',
            evidenceId: 'evidence-v1',
            associationId: 'association-v1',
            sourcePayloadRef: 's3://payloads/email/raw-1',
          },
        ],
      }),
    ).toBe(
      buildOutputDedupeKey({
        ...base,
        sourceRefs: [
          {
            source: 'email',
            rawEventId: 'raw-1',
            evidenceId: 'evidence-v2',
            associationId: 'association-v2',
            sourcePayloadRef: 's3://payloads/email/raw-1',
          },
        ],
      }),
    );
  });

  it('includes target identity in output dedupe keys', () => {
    const base = {
      teamId: 'team-1',
      clusterId: null,
      targetKind: 'object',
      operation: 'create',
      targetId: null,
      sourceRefs: [{ source: 'email', rawEventId: 'raw-email', evidenceId: 'ev-email' }],
      authorityPolicyVersion: 'authority-1',
      plannerVersion: 'planner-1',
    };

    expect(buildOutputDedupeKey({ ...base, targetIdentity: 'create-company' })).not.toBe(
      buildOutputDedupeKey({ ...base, targetIdentity: 'create-person' }),
    );
  });

  it('requires source refs to cite a concrete provenance handle', () => {
    expect(validateSourceRefs([])).toEqual({
      ok: false,
      errors: ['at least one source ref is required'],
    });

    expect(validateSourceRefs([{ source: 'email' }])).toEqual({
      ok: false,
      errors: ['source_refs[0] must cite raw event, evidence, association, output, or payload'],
    });

    expect(
      validateSourceRefs([
        { source: 'email', rawEventId: 'raw-1' },
        { source: 'monday', sourcePayloadRef: 's3://payloads/monday/1' },
      ]),
    ).toEqual({ ok: true, errors: [] });
  });
});

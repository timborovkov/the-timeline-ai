import { describe, expectTypeOf, it } from 'vitest';

import type { objects as rootObjects } from '#src/index.js';
import type * as objectIndex from '#src/objects/index.js';
import type * as objectTypes from '#src/objects/types.js';

describe('object type export contracts', () => {
  it('keeps both object entry points and the root namespace type-identical', () => {
    expectTypeOf<objectIndex.ObjectType>().toEqualTypeOf<objectTypes.ObjectType>();
    expectTypeOf<objectIndex.ObjectListFilter>().toEqualTypeOf<objectTypes.ObjectListFilter>();
    expectTypeOf<objectIndex.ObjectCountFilter>().toEqualTypeOf<objectTypes.ObjectCountFilter>();
    expectTypeOf<objectIndex.ObjectSearchFilter>().toEqualTypeOf<objectTypes.ObjectSearchFilter>();
    expectTypeOf<objectIndex.ObjectRow>().toEqualTypeOf<objectTypes.ObjectRow>();
    expectTypeOf<objectIndex.TaskPrimaryProjectRow>().toEqualTypeOf<objectTypes.TaskPrimaryProjectRow>();
    expectTypeOf<rootObjects.ObjectRow>().toEqualTypeOf<objectTypes.ObjectRow>();
    expectTypeOf<rootObjects.ObjectListFilter>().toEqualTypeOf<objectTypes.ObjectListFilter>();
  });
});

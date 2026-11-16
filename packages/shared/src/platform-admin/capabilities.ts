export const OPERATOR_CAPABILITIES = {
  read: { readOnly: true, impersonation: true, maintenance: false },
  write: { readOnly: false, impersonation: true, maintenance: false },
  accountRead: { readOnly: true, impersonation: false, maintenance: false },
  accountWrite: { readOnly: false, impersonation: false, maintenance: false },
  maintenanceRead: { readOnly: true, impersonation: true, maintenance: true },
  maintenanceWrite: { readOnly: false, impersonation: true, maintenance: true },
  maintenanceAccountRead: { readOnly: true, impersonation: false, maintenance: true },
  maintenanceAccountWrite: { readOnly: false, impersonation: false, maintenance: true },
} as const;

export type OperatorCapability = (typeof OPERATOR_CAPABILITIES)[keyof typeof OPERATOR_CAPABILITIES];
type OperationPaths<T> = {
  [K in keyof T & string]: K extends 'postCommitDb' | 'postCommitEffects' | 'teamId' | 'userId'
    ? never
    : T[K] extends (...args: never[]) => unknown
      ? K
      : T[K] extends readonly unknown[]
        ? never
        : T[K] extends object
          ? `${K}.${OperationPaths<T[K]>}`
          : never;
}[keyof T & string];

/** Every exposed operation must declare policy; renaming a method cannot change access. */
export type OperatorScopePolicy<T> = Record<OperationPaths<T>, OperatorCapability>;

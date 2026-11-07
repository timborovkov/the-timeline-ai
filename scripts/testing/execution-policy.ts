import ts from 'typescript';

export type TestExecutionPolicy =
  | { isolation?: 'file' }
  | { isolation: 'registration' }
  | { isolation: 'batch'; batchSize: number };

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titlePattern(title: ts.Expression, parameterized: boolean): string | undefined {
  const literal = (value: string) => {
    if (!parameterized) return escapePattern(value);
    return value
      .split(/(%[%sdifjoOp#]|\$[\w.]+)/g)
      .map((part) => {
        if (part === '%%') return '%';
        return /^(?:%[%sdifjoOp#]|\$[\w.]+)$/.test(part) ? '[\\s\\S]*' : escapePattern(part);
      })
      .join('');
  };
  if (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
    return literal(title.text);
  if (ts.isTemplateExpression(title)) {
    return (
      literal(title.head.text) +
      title.templateSpans.map((span) => '[\\s\\S]*' + literal(span.literal.text)).join('')
    );
  }
  return undefined;
}

/** Partition registrations, keeping all runtime rows of each parameterized registration together. */
export function testExecutionPatterns(
  source: string,
  file: string,
  policy: TestExecutionPolicy,
): (string | undefined)[] {
  if (!policy.isolation || policy.isolation === 'file') return [undefined];
  const size = policy.isolation === 'registration' ? 1 : policy.batchSize;
  if (!Number.isInteger(size) || size < 1)
    throw new Error(`${file}: test batchSize must be a positive integer`);
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const testNames = new Set<string>();
  const describeNames = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of tree.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'bun:test'
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (['it', 'test'].includes(element.propertyName?.text ?? element.name.text))
        testNames.add(element.name.text);
      if ((element.propertyName?.text ?? element.name.text) === 'describe')
        describeNames.add(element.name.text);
    }
  }
  // Isolated runs cannot safely discover registrations after a test function escapes.
  function rejectEscapedRegistrations(node: ts.Node): void {
    if (ts.isIdentifier(node) && (testNames.has(node.text) || namespaces.has(node.text))) {
      if (ts.isImportSpecifier(node.parent) || ts.isNamespaceImport(node.parent)) return;
      let expression: ts.Node = node;
      while (
        ts.isPropertyAccessExpression(expression.parent) &&
        expression.parent.expression === expression
      )
        expression = expression.parent;
      const isNamespaceUtility =
        namespaces.has(node.text) &&
        ts.isPropertyAccessExpression(expression) &&
        !['it', 'test'].includes(expression.name.text) &&
        !expression.getText(tree).match(/\.(?:it|test)(?:\.|$)/);
      if (
        !isNamespaceUtility &&
        !(ts.isCallExpression(expression.parent) && expression.parent.expression === expression)
      )
        throw new Error(
          `${file}: isolated test functions cannot be aliased or passed as values; use explicit file isolation`,
        );
    }
    ts.forEachChild(node, rejectEscapedRegistrations);
  }
  rejectEscapedRegistrations(tree);
  function inSkippedSuite(node: ts.Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (!ts.isCallExpression(parent) || !ts.isPropertyAccessExpression(parent.expression))
        continue;
      const callee = parent.expression;
      if (!['skip', 'todo'].includes(callee.name.text)) continue;
      if (ts.isIdentifier(callee.expression) && describeNames.has(callee.expression.text))
        return true;
      if (
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === 'describe' &&
        ts.isIdentifier(callee.expression.expression) &&
        namespaces.has(callee.expression.expression.text)
      )
        return true;
    }
    return false;
  }
  const patterns = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      let callee: ts.Expression = node.expression;
      const modifiers: string[] = [];
      let factoryCall = false;
      while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) {
        if (ts.isPropertyAccessExpression(callee)) {
          modifiers.push(callee.name.text);
          callee = callee.expression;
        } else {
          factoryCall = true;
          callee = callee.expression;
        }
      }
      if (
        ts.isIdentifier(callee) &&
        (testNames.has(callee.text) ||
          (namespaces.has(callee.text) && modifiers.some((name) => ['it', 'test'].includes(name))))
      ) {
        const isFactory =
          !factoryCall && modifiers.some((modifier) => ['each', 'if', 'skipIf'].includes(modifier));
        if (isFactory && !(ts.isCallExpression(node.parent) && node.parent.expression === node))
          throw new Error(
            `${file}: isolated test factories cannot be aliased; use explicit file isolation`,
          );
        if (
          !isFactory &&
          !inSkippedSuite(node) &&
          !modifiers.some((modifier) => ['skip', 'todo'].includes(modifier))
        ) {
          const title = node.arguments[0];
          const pattern = title && titlePattern(title, modifiers.includes('each'));
          if (pattern === undefined)
            throw new Error(
              `${file}: isolated test titles must be literals or templates; use explicit file isolation for computed titles`,
            );
          patterns.add(pattern);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (patterns.size === 0)
    throw new Error(
      `${file}: no runnable bun:test registrations found for ${policy.isolation} isolation`,
    );
  const names = [...patterns];
  const batches: string[] = [];
  for (let index = 0; index < names.length; index += size) {
    batches.push('(?:' + names.slice(index, index + size).join('|') + ')$');
  }
  return batches;
}

const restoreEditorCode = (node, source) => {
  if (node.type !== 'mdxJsxFlowElement' || node.name !== 'Editor') {
    return;
  }

  const attribute = node.attributes.find(
    (candidate) =>
      candidate.type === 'mdxJsxAttribute' && candidate.name === 'code',
  );
  const statement = attribute?.value?.data?.estree?.body?.[0];
  const expression =
    statement?.type === 'ExpressionStatement'
      ? statement.expression
      : undefined;

  if (
    expression?.type !== 'TemplateLiteral' ||
    expression.expressions.length !== 0 ||
    expression.quasis.length !== 1 ||
    attribute.position?.start.offset == null ||
    attribute.position.end.offset == null
  ) {
    return;
  }

  const rawAttribute = source.slice(
    attribute.position.start.offset,
    attribute.position.end.offset,
  );
  const firstBacktick = rawAttribute.indexOf('`');
  const lastBacktick = rawAttribute.lastIndexOf('`');

  if (firstBacktick === -1 || lastBacktick === firstBacktick) {
    return;
  }

  const rawCode = rawAttribute.slice(firstBacktick + 1, lastBacktick);
  attribute.value.value = `\`${rawCode}\``;
  expression.quasis[0].value.raw = rawCode;
};

const walk = (node, source) => {
  restoreEditorCode(node, source);

  for (const child of node.children ?? []) {
    walk(child, source);
  }
};

// MDX treats two leading spaces on expression continuation lines as syntax.
// Restore the original template literal before it reaches the generated props.
export const preserveEditorCode = () => (tree, file) => {
  walk(tree, String(file.value));
};

interface RuleContext {
  report(descriptor: { node: unknown; messageId: string; data?: Record<string, unknown> }): void;
}

interface AstNode {
  type: string;
  name?: string | AstNode;
  value?: unknown;
  expression?: AstNode;
  properties?: AstNode[];
  key?: AstNode;
  left?: AstNode;
  right?: AstNode;
  object?: AstNode;
  property?: AstNode;
  computed?: boolean;
  callee?: AstNode;
  arguments?: AstNode[];
  openingElement?: AstNode & { attributes?: AstNode[]; name?: AstNode };
  attributes?: AstNode[];
}

const noRawHistory = {
  meta: {
    type: 'problem',
    docs: { description: 'Use the Homeframe router instead of mutating browser history directly.' },
    schema: [],
    messages: {
      rawHistory: 'Use the Homeframe router for {{method}} so entry keys, direction, and scroll restoration remain coherent.',
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee;
        const path = memberPath(callee);
        if (!path || (!path.startsWith('history.') && !path.startsWith('window.history.'))) return;
        const method = getName(callee?.property);
        if (!method || !['pushState', 'replaceState', 'back', 'forward', 'go'].includes(method)) return;
        context.report({ node, messageId: 'rawHistory', data: { method: `history.${method}` } });
      },
    };
  },
};

const noRawViewport = {
  meta: {
    type: 'problem',
    docs: { description: 'Use Homeframe normalized viewport hooks and variables.' },
    schema: [],
    messages: {
      rawViewport: 'Use useViewport() or --hf-viewport-* instead of {{name}}.',
    },
  },
  create(context: RuleContext) {
    return {
      MemberExpression(node: AstNode) {
        const name = memberPath(node) ?? '';
        if (name === 'window.innerHeight' || name === 'window.visualViewport') {
          context.report({ node, messageId: 'rawViewport', data: { name } });
        }
      },
    };
  },
};

const noUnsafeInputSize = {
  meta: {
    type: 'problem',
    docs: { description: 'Prevent iOS focus zoom by requiring at least 16px editable text.' },
    schema: [],
    messages: {
      unsafeSize: 'Editable controls must use a computed font size of at least 16px. Prefer a Homeframe input primitive.',
    },
  },
  create(context: RuleContext) {
    return {
      JSXOpeningElement(node: AstNode) {
        const name = getName(node.name);
        if (!['input', 'textarea', 'select'].includes(name ?? '')) return;
        const size = jsxStyleProperty(node, 'fontSize');
        if (typeof size === 'number' && size < 16) context.report({ node, messageId: 'unsafeSize' });
        if (typeof size === 'string') {
          const match = /^([0-9.]+)px$/.exec(size.trim());
          if (match && Number(match[1]) < 16) context.report({ node, messageId: 'unsafeSize' });
        }
      },
    };
  },
};

const noDocumentScroll = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep the document stationary and scroll AppScrollView instead.' },
    schema: [],
    messages: {
      documentScroll: 'Do not mutate document scrolling with {{name}}. Scroll a declared AppScrollView or nested scroll region.',
    },
  },
  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const name = memberPath(node.callee);
        if (name && [
          'window.scrollTo',
          'window.scrollBy',
          'document.body.scrollTo',
          'document.body.scrollBy',
          'document.documentElement.scrollTo',
          'document.documentElement.scrollBy',
        ].includes(name)) context.report({ node, messageId: 'documentScroll', data: { name } });
      },
      AssignmentExpression(node: AstNode) {
        const name = memberPath(node.left);
        if (name && /^(?:document\.(?:body|documentElement)|window)\.scroll(?:Top|Left)$/.test(name)) {
          context.report({ node, messageId: 'documentScroll', data: { name } });
        }
      },
    };
  },
};

const noUntrackedFixedPosition = {
  meta: {
    type: 'problem',
    docs: { description: 'Use Homeframe header, dock, or portal primitives for viewport-bound UI.' },
    schema: [],
    messages: {
      fixedPosition: 'Inline position: {{position}} binds to the browser viewport. Use AppHeader, ViewportDock, or HomeframePortal.',
    },
  },
  create(context: RuleContext) {
    return {
      JSXOpeningElement(node: AstNode) {
        const position = jsxStyleProperty(node, 'position');
        if (position === 'fixed' || position === 'sticky') {
          context.report({ node, messageId: 'fixedPosition', data: { position } });
        }
      },
    };
  },
};

function getName(node: AstNode | string | undefined): string | undefined {
  if (typeof node === 'string') return node;
  if (!node) return undefined;
  return typeof node.name === 'string' ? node.name : undefined;
}

function memberPath(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Identifier') return getName(node);
  if (node.type !== 'MemberExpression' || node.computed) return undefined;
  const object = memberPath(node.object);
  const property = getName(node.property);
  return object && property ? `${object}.${property}` : undefined;
}

function jsxStyleProperty(node: AstNode, propertyName: string): unknown {
  const style = node.attributes?.find((attribute) => getName(attribute.name) === 'style');
  const expression = style?.value && typeof style.value === 'object'
    ? (style.value as AstNode).expression
    : undefined;
  if (expression?.type !== 'ObjectExpression') return undefined;
  const property = expression.properties?.find((item) => getName(item.key) === propertyName);
  const value = property?.value;
  if (!value || typeof value !== 'object') return undefined;
  const valueNode = value as AstNode;
  return valueNode.type === 'Literal' ? valueNode.value : undefined;
}

const plugin = {
  meta: { name: '@builtbyted/eslint-plugin', version: '0.1.0' },
  rules: {
    'no-raw-history': noRawHistory,
    'no-raw-viewport': noRawViewport,
    'no-unsafe-input-size': noUnsafeInputSize,
    'no-document-scroll': noDocumentScroll,
    'no-untracked-fixed-position': noUntrackedFixedPosition,
  },
  configs: {} as Record<string, unknown>,
};

plugin.configs.recommended = {
  plugins: { homeframe: plugin },
  rules: {
    'homeframe/no-raw-history': 'error',
    'homeframe/no-raw-viewport': 'warn',
    'homeframe/no-unsafe-input-size': 'error',
    'homeframe/no-document-scroll': 'error',
    'homeframe/no-untracked-fixed-position': 'warn',
  },
};

export default plugin;
export const rules = plugin.rules;

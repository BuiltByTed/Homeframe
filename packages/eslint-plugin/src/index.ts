interface RuleContext {
  report(descriptor: { node: unknown; messageId: string; data?: Record<string, unknown> }): void;
}

interface AstNode {
  type: string;
  name?: string | AstNode;
  value?: unknown;
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
        if (callee?.type !== 'MemberExpression' || getName(callee.object) !== 'history') return;
        const method = getName(callee.property);
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
        const object = getName(node.object);
        const property = getName(node.property);
        const name = object && property ? `${object}.${property}` : '';
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
        const style = node.attributes?.find((attribute) => getName(attribute.name) === 'style');
        const raw = JSON.stringify(style ?? '');
        const match = /fontSize[^0-9]+([0-9.]+)/.exec(raw);
        if (match && Number(match[1]) < 16) context.report({ node, messageId: 'unsafeSize' });
      },
    };
  },
};

function getName(node: AstNode | string | undefined): string | undefined {
  if (typeof node === 'string') return node;
  if (!node) return undefined;
  return typeof node.name === 'string' ? node.name : undefined;
}

const plugin = {
  meta: { name: '@homeframe/eslint-plugin', version: '0.1.0' },
  rules: {
    'no-raw-history': noRawHistory,
    'no-raw-viewport': noRawViewport,
    'no-unsafe-input-size': noUnsafeInputSize,
  },
  configs: {} as Record<string, unknown>,
};

plugin.configs.recommended = {
  plugins: { homeframe: plugin },
  rules: {
    'homeframe/no-raw-history': 'error',
    'homeframe/no-raw-viewport': 'warn',
    'homeframe/no-unsafe-input-size': 'error',
  },
};

export default plugin;
export const rules = plugin.rules;

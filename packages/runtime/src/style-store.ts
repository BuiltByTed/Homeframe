let cachedDeclaration: CSSStyleDeclaration | null = null;

/**
 * Returns the nonce-authorized :root declaration injected before app code. The
 * document style attribute is only a development fallback for runtimes used
 * without the Homeframe build adapter.
 */
export function getHomeframeRootStyle(): CSSStyleDeclaration {
  if (cachedDeclaration) return cachedDeclaration;
  if (typeof document === 'undefined') return {} as CSSStyleDeclaration;
  const element = document.getElementById('homeframe-runtime-vars') as HTMLStyleElement | null;
  try {
    const rule = element?.sheet?.cssRules[0] as CSSStyleRule | undefined;
    if (rule?.style) {
      cachedDeclaration = rule.style;
      return rule.style;
    }
  } catch {
    // A development host may restrict stylesheet inspection. The fallback
    // keeps the standalone runtime usable and doctor reports CSP deployment.
  }
  return document.documentElement.style;
}

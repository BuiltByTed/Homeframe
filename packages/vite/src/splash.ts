export interface BootSplashMarkupOptions {
  inlineLogo: string;
  title: string | undefined;
  appName: string;
}

export function bootSplashMarkup({
  inlineLogo,
  title,
  appName,
}: BootSplashMarkupOptions): string {
  const resolvedTitle = title ?? appName;
  const label = resolvedTitle === '' ? '' : `<span>${escapeHtml(resolvedTitle)}</span>`;
  return `<div id="homeframe-boot-splash" aria-hidden="true"><img src="${escapeHtml(inlineLogo)}" alt="">${label}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

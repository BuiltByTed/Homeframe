export interface PushSubscriptionTransport {
  upsert(subscription: PushSubscriptionJSON): Promise<void>;
  remove(endpoint: string): Promise<void>;
}

export interface HttpPushSubscriptionTransportOptions {
  endpoint: string;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
}

export function createHttpPushSubscriptionTransport(
  options: HttpPushSubscriptionTransportOptions,
): PushSubscriptionTransport {
  return {
    async upsert(subscription) {
      const response = await fetch(options.endpoint, {
        method: 'PUT',
        credentials: options.credentials ?? 'same-origin',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify(subscription),
      });
      if (!response.ok) throw new Error(`Push subscription update failed (${response.status}).`);
    },
    async remove(endpoint) {
      const response = await fetch(options.endpoint, {
        method: 'DELETE',
        credentials: options.credentials ?? 'same-origin',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify({ endpoint }),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Push subscription removal failed (${response.status}).`);
      }
    },
  };
}

export function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

export async function setAppBadge(count?: number): Promise<boolean> {
  const badgeNavigator = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (typeof count === 'number' && count > 0 && badgeNavigator.setAppBadge) {
    await badgeNavigator.setAppBadge(count);
    return true;
  }
  if (badgeNavigator.clearAppBadge) {
    await badgeNavigator.clearAppBadge();
    return true;
  }
  // Some WebKit builds expose setAppBadge before clearAppBadge. Setting zero
  // is the Badging API's equivalent clear operation and keeps those versions
  // from leaving an old Home Screen count behind.
  if (badgeNavigator.setAppBadge) {
    await badgeNavigator.setAppBadge(0);
    return true;
  }
  return false;
}

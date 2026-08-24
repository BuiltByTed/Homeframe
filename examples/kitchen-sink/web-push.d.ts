declare module 'web-push' {
  export interface WebPushSubscription {
    endpoint: string;
    expirationTime?: number | null;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  export interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }

  interface SendOptions {
    TTL?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
    timeout?: number;
  }

  interface WebPush {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    generateVAPIDKeys(): VapidKeys;
    sendNotification(
      subscription: WebPushSubscription,
      payload?: string,
      options?: SendOptions,
    ): Promise<unknown>;
  }

  const webpush: WebPush;
  export default webpush;
}

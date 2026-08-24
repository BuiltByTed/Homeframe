import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import sharp from 'sharp';
import type { GeneratedHomeframeAsset, HomeframeConfig } from './types.js';

interface AppleDevice {
  cssWidth: number;
  cssHeight: number;
  ratio: number;
}

const appleDevices: AppleDevice[] = [
  { cssWidth: 320, cssHeight: 568, ratio: 2 },
  { cssWidth: 375, cssHeight: 667, ratio: 2 },
  { cssWidth: 414, cssHeight: 736, ratio: 3 },
  { cssWidth: 375, cssHeight: 812, ratio: 3 },
  { cssWidth: 414, cssHeight: 896, ratio: 2 },
  { cssWidth: 414, cssHeight: 896, ratio: 3 },
  { cssWidth: 390, cssHeight: 844, ratio: 3 },
  { cssWidth: 428, cssHeight: 926, ratio: 3 },
  { cssWidth: 393, cssHeight: 852, ratio: 3 },
  { cssWidth: 430, cssHeight: 932, ratio: 3 },
  { cssWidth: 402, cssHeight: 874, ratio: 3 },
  { cssWidth: 440, cssHeight: 956, ratio: 3 },
  { cssWidth: 744, cssHeight: 1133, ratio: 2 },
  { cssWidth: 768, cssHeight: 1024, ratio: 2 },
  { cssWidth: 810, cssHeight: 1080, ratio: 2 },
  { cssWidth: 820, cssHeight: 1180, ratio: 2 },
  { cssWidth: 834, cssHeight: 1112, ratio: 2 },
  { cssWidth: 834, cssHeight: 1194, ratio: 2 },
  { cssWidth: 1024, cssHeight: 1366, ratio: 2 },
];

export interface GeneratedAssetSet {
  assets: GeneratedHomeframeAsset[];
  startupLinks: Array<{ href: string; media: string }>;
  inlineLogo: string;
}

function sourcePath(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

async function iconBuffer(
  source: Buffer,
  size: number,
  paddingRatio = 0,
  background: string | { r: number; g: number; b: number; alpha: number } = { r: 0, g: 0, b: 0, alpha: 0 },
): Promise<Buffer> {
  const contentSize = Math.round(size * (1 - 2 * paddingRatio));
  const content = await sharp(source).resize(contentSize, contentSize, {
    fit: 'contain',
    withoutEnlargement: false,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  }).composite([{ input: content, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer();
}

async function startupImage(
  source: Buffer,
  width: number,
  height: number,
  background: string,
): Promise<Buffer> {
  const logoSize = Math.max(96, Math.round(Math.min(width, height) * 0.22));
  const logo = await iconBuffer(source, logoSize);
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export async function generateAssets(
  config: HomeframeConfig,
  root: string,
  base: string,
): Promise<GeneratedAssetSet> {
  const icon = await readFile(sourcePath(root, config.app.icon));
  const maskable = config.app.maskableIcon
    ? await readFile(sourcePath(root, config.app.maskableIcon))
    : icon;
  const appleTouchIcon = config.app.appleTouchIcon
    ? await readFile(sourcePath(root, config.app.appleTouchIcon))
    : icon;
  const splashLogo = config.splash?.logo
    ? await readFile(sourcePath(root, config.splash.logo))
    : icon;
  const assets: GeneratedHomeframeAsset[] = [];

  const addIcon = async (
    fileName: string,
    source: Buffer,
    size: number,
    purpose: string,
    paddingRatio = 0,
    background?: string,
  ) => {
    assets.push({
      fileName,
      source: await iconBuffer(source, size, paddingRatio, background),
      mimeType: 'image/png',
      purpose,
      width: size,
      height: size,
    });
  };

  await Promise.all([
    addIcon('generated/icon-192.png', icon, 192, 'manifest any'),
    addIcon('generated/icon-512.png', icon, 512, 'manifest any'),
    // A centered square that is 56.56% of the canvas fits wholly within the
    // standardized 40%-radius maskable safe circle. The full canvas is opaque,
    // so no source artwork is silently cropped by the platform mask.
    addIcon('generated/icon-maskable-512.png', maskable, 512, 'manifest maskable; content contained in safe circle', 0.2172, config.app.backgroundColor),
    addIcon('generated/apple-touch-icon.png', appleTouchIcon, 180, 'Apple touch icon'),
    addIcon('generated/favicon-32.png', icon, 32, 'favicon'),
    addIcon('generated/notification-icon.png', icon, 192, 'notification icon'),
    addIcon('generated/notification-badge.png', maskable, 96, 'notification badge', 0.15),
  ]);

  const inlineLogoBuffer = await iconBuffer(icon, 128);
  const inlineLogo = `data:image/png;base64,${inlineLogoBuffer.toString('base64')}`;
  const startupLinks: Array<{ href: string; media: string }> = [];

  if (config.splash?.generateAppleStartupImages !== false) {
    const scheme = config.app.colorScheme ?? 'system';
    const lightBackground = config.app.backgroundColor;
    const darkBackground = config.app.backgroundColorDark ?? lightBackground;
    const variants = scheme === 'system' && darkBackground !== lightBackground
      ? [
          { suffix: '', background: lightBackground, media: '(prefers-color-scheme: light)' },
          { suffix: '-dark', background: darkBackground, media: '(prefers-color-scheme: dark)' },
        ]
      : [{
          suffix: '',
          background: scheme === 'dark' ? darkBackground : lightBackground,
          media: '',
        }];
    for (const device of appleDevices) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const cssWidth = orientation === 'portrait' ? device.cssWidth : device.cssHeight;
        const cssHeight = orientation === 'portrait' ? device.cssHeight : device.cssWidth;
        const pixelWidth = cssWidth * device.ratio;
        const pixelHeight = cssHeight * device.ratio;
        for (const variant of variants) {
          const fileName = `generated/splash-${cssWidth}x${cssHeight}@${device.ratio}x${variant.suffix}.png`;
          assets.push({
            fileName,
            source: await startupImage(splashLogo, pixelWidth, pixelHeight, variant.background),
            mimeType: 'image/png',
            purpose: `Apple startup ${orientation}${variant.media ? ` ${variant.media}` : ''}`,
            width: pixelWidth,
            height: pixelHeight,
          });
          startupLinks.push({
            href: joinBase(base, fileName),
            media: [
              `(device-width: ${cssWidth}px)`,
              `(device-height: ${cssHeight}px)`,
              `(-webkit-device-pixel-ratio: ${device.ratio})`,
              `(orientation: ${orientation})`,
              variant.media,
            ].filter(Boolean).join(' and '),
          });
        }
      }
    }
  }

  return { assets, startupLinks, inlineLogo };
}

export function joinBase(base: string, path: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path.replace(/^\//, '')}`;
}

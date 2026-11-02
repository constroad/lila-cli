/**
 * The pure half of `lila ota publish` (02/11/2026): from what `expo export` produced to the
 * manifest José's machine signs, plus the guards that decide whether it may be published. Ported
 * from Lilachat's `shared/src/otaPublish.ts`; the I/O lives in `otaPublish.mjs`. Pure: without
 * filesystem, network or `process`.
 *
 * LilaStore hosts the OTA of every RN app of the house: the asset urls point at
 * `<lilastore>/api/v1/apps/<slug>/ota/assets/<sha256>` and the server refuses a manifest whose
 * assets live under another app.
 */

/** The exact bytes signed for «nothing newer». The server verifies the same literal. */
export const NO_UPDATE_DIRECTIVE = '{"type":"noUpdateAvailable"}';

/** Development addresses that must not be baked into a bundle that reaches phones. */
export const DEV_HOSTS = ['10.0.2.2', '127.0.0.1', 'localhost'];

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
};
const BUNDLE_CONTENT_TYPE = 'application/javascript';

export const contentTypeOfExtension = (extension) =>
  CONTENT_TYPES[String(extension).replace(/^\./, '').toLowerCase()] ?? 'application/octet-stream';

const trimSlash = (url) => String(url).replace(/\/+$/, '');

/** Where the phones of `slug` ask for updates; `app.json` → `expo.updates.url` must be exactly this. */
export const manifestUrl = (base, slug) => `${trimSlash(base)}/api/v1/apps/${slug}/ota/manifest`;
export const assetPath = (slug, hash) => `/api/v1/apps/${slug}/ota/assets/${hash}`;

function assetOf(filePath, digests, base, slug, kind) {
  const digest = digests[filePath];
  if (!digest) throw new Error(`Falta el hash del archivo ${filePath}`);
  return {
    hash: digest.sha256,
    key: digest.md5,
    contentType: kind.contentType,
    fileExtension: `.${kind.extension}`,
    url: `${trimSlash(base)}${assetPath(slug, digest.sha256)}`,
  };
}

/**
 * The manifest of one update. `digests` by path inside the export folder: SHA-256 (base64url)
 * names the file on the server, MD5 (hex) is the key the phone caches it under.
 */
export function buildManifest({ id, createdAt, runtimeVersion, metadata, digests, base, slug, expoClient, gitSha }) {
  const android = metadata?.fileMetadata?.android;
  if (!android?.bundle) throw new Error('El export no trae un bundle de android');
  return {
    id,
    createdAt,
    runtimeVersion,
    launchAsset: assetOf(android.bundle, digests, base, slug, { contentType: BUNDLE_CONTENT_TYPE, extension: 'bundle' }),
    assets: android.assets.map((asset) =>
      assetOf(asset.path, digests, base, slug, { contentType: contentTypeOfExtension(asset.ext), extension: String(asset.ext).replace(/^\./, '') })
    ),
    metadata: {},
    extra: { expoClient, gitSha },
  };
}

/** Sends every phone of the runtime back to the JavaScript inside its APK. The signature covers these exact bytes. */
export const rollbackDirective = (now) => JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime: now.toISOString() } });

/** `ota-runtime.json` remembers the APK out there; a different runtime means something native changed. */
export function assertRuntimeMatches(currentRuntime, snapshot) {
  if (currentRuntime !== snapshot.runtimeVersion) {
    throw new Error(`Cambió algo nativo desde el APK ${snapshot.versionCode}: esto va en un APK, no por OTA`);
  }
}

const PRODUCTION_URL = /^https:\/\/[^\s/]+/;

/**
 * The environment an OTA export runs with: the APK build's (`lila.json` → `build.env`), never the
 * developer's `.env` (25/10/2026: that one baked `http://10.0.2.2:4003` into two Lilachat updates).
 */
export function buildEnvOf(lilaConfig) {
  const env = lilaConfig?.build?.env ?? {};
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  if (typeof apiUrl !== 'string' || !PRODUCTION_URL.test(apiUrl)) {
    throw new Error('lila.json necesita build.env.EXPO_PUBLIC_API_URL con una URL https: sin ella la OTA heredaría el .env local');
  }
  return Object.fromEntries(Object.entries(env).filter((entry) => typeof entry[1] === 'string'));
}

/** How many times each development host appears in a bundle (the strings of a Hermes bundle are plain ASCII). */
export const countDevHosts = (bundle) => Object.fromEntries(DEV_HOSTS.map((host) => [host, bundle.split(host).length - 1]));

/**
 * Stops a bundle that does not point at production: it must carry the production url and no more
 * development hosts than the bundle of the APK out there (which has a few of its own).
 */
export function assertBundleBakedUrl(bundle, { apiUrl, baseline }) {
  if (!bundle.includes(apiUrl)) throw new Error(`El bundle no trae ${apiUrl}: los teléfonos no sabrían a qué server hablar`);
  const found = countDevHosts(bundle);
  for (const host of DEV_HOSTS) {
    const allowed = baseline?.[host] ?? 0;
    if (found[host] > allowed) {
      throw new Error(`El bundle trae ${found[host]} veces ${host} y el APK solo ${allowed}: se coló una URL de desarrollo (revisa los .env)`);
    }
  }
}

/**
 * The APK has to ask LilaStore for this app: otherwise publishing here changes nothing for any
 * phone (an APK of before the migration still asks its own server). Said before exporting anything.
 */
export function assertUpdatesUrl(expoConfig, base, slug) {
  const expected = manifestUrl(base, slug);
  const configured = expoConfig?.updates?.url;
  if (configured !== expected) {
    throw new Error(
      `app.json → expo.updates.url es ${configured ?? '(nada)'} y los teléfonos tienen que preguntar a ${expected}. ` +
        'Hasta que un APK con esa URL esté instalado, publicar aquí no le llega a nadie.'
    );
  }
  if (!expoConfig?.updates?.codeSigningCertificate) {
    throw new Error('app.json → expo.updates.codeSigningCertificate falta: sin certificado en el APK, el teléfono no verifica la firma.');
  }
}

/** Where the private key may be: the env var, then `~/.config/<slug>-ota/`, then `~/.config/<repo>-ota/` (lilafotos publishes slug `fotos`). */
export function privateKeyCandidates({ envPath, home, slug, repoName }) {
  const names = [...new Set([slug, repoName].filter(Boolean))];
  return envPath ? [envPath] : names.map((name) => `${home}/.config/${name}-ota/private-key.pem`);
}

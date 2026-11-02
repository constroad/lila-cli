import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  NO_UPDATE_DIRECTIVE,
  assertBundleBakedUrl,
  assertRuntimeMatches,
  assertUpdatesUrl,
  buildEnvOf,
  buildManifest,
  contentTypeOfExtension,
  countDevHosts,
  manifestUrl,
  privateKeyCandidates,
  rollbackDirective,
} from './ota.mjs';

const metadata = { fileMetadata: { android: { bundle: '_expo/static/js/android/index.hbc', assets: [{ path: 'assets/abc', ext: 'png' }] } } };
const digests = { '_expo/static/js/android/index.hbc': { sha256: 'B'.repeat(43), md5: 'b1' }, 'assets/abc': { sha256: 'A'.repeat(43), md5: 'a1' } };

describe('buildManifest', () => {
  test('points every asset at THIS app on LilaStore, by its sha256', () => {
    const manifest = buildManifest({ id: 'id', createdAt: 'c', runtimeVersion: 'r', metadata, digests, base: 'https://lilastore.constroad.com/', slug: 'fotos', expoClient: {}, gitSha: 'g' });
    assert.equal(manifest.launchAsset.url, `https://lilastore.constroad.com/api/v1/apps/fotos/ota/assets/${'B'.repeat(43)}`);
    assert.equal(manifest.launchAsset.contentType, 'application/javascript');
    assert.equal(manifest.launchAsset.key, 'b1');
    assert.deepEqual(manifest.assets.map((asset) => [asset.contentType, asset.fileExtension]), [['image/png', '.png']]);
  });

  test('refuses an export without an android bundle or with a file it did not hash', () => {
    assert.throws(() => buildManifest({ metadata: { fileMetadata: {} }, digests }), /bundle de android/);
    assert.throws(() => buildManifest({ metadata, digests: {}, base: 'x', slug: 's' }), /Falta el hash/);
  });
});

describe('guards', () => {
  test('the export only runs with an https API url from lila.json', () => {
    assert.deepEqual(buildEnvOf({ build: { env: { EXPO_PUBLIC_API_URL: 'https://x.com', N: 1 } } }), { EXPO_PUBLIC_API_URL: 'https://x.com' });
    assert.throws(() => buildEnvOf({ build: { env: { EXPO_PUBLIC_API_URL: 'http://10.0.2.2:4003' } } }), /https/);
    assert.throws(() => buildEnvOf(null), /lila.json/);
  });

  test('a bundle needs the production url and no more dev hosts than its APK', () => {
    const bundle = 'https://x.com … localhost';
    assert.doesNotThrow(() => assertBundleBakedUrl(bundle, { apiUrl: 'https://x.com', baseline: { localhost: 1 } }));
    assert.throws(() => assertBundleBakedUrl(bundle, { apiUrl: 'https://x.com', baseline: {} }), /localhost/);
    assert.throws(() => assertBundleBakedUrl('nada', { apiUrl: 'https://x.com', baseline: {} }), /no trae/);
    assert.deepEqual(countDevHosts('10.0.2.2 10.0.2.2'), { '10.0.2.2': 2, '127.0.0.1': 0, localhost: 0 });
  });

  test('a native change since the APK goes in an APK, not by OTA', () => {
    assert.doesNotThrow(() => assertRuntimeMatches('r1', { runtimeVersion: 'r1', versionCode: 5 }));
    assert.throws(() => assertRuntimeMatches('r2', { runtimeVersion: 'r1', versionCode: 5 }), /APK 5/);
  });

  test('the APK must ask LilaStore for this app, with a certificate inside', () => {
    const base = 'https://lilastore.constroad.com';
    const ok = { updates: { url: manifestUrl(base, 'lilachat'), codeSigningCertificate: './certs/certificate.crt' } };
    assert.doesNotThrow(() => assertUpdatesUrl(ok, base, 'lilachat'));
    // An APK of before the migration asks its own server: publishing here would reach nobody.
    assert.throws(() => assertUpdatesUrl({ updates: { url: 'https://lilachat.constroad.com/api/ota/manifest' } }, base, 'lilachat'), /no le llega a nadie/);
    assert.throws(() => assertUpdatesUrl({ updates: { url: manifestUrl(base, 'lilachat') } }, base, 'lilachat'), /codeSigningCertificate/);
  });
});

describe('signing inputs', () => {
  test('the rollback directive and the noUpdate literal are fixed bytes', () => {
    assert.equal(rollbackDirective(new Date('2026-11-02T00:00:00Z')), '{"type":"rollBackToEmbedded","parameters":{"commitTime":"2026-11-02T00:00:00.000Z"}}');
    assert.equal(NO_UPDATE_DIRECTIVE, '{"type":"noUpdateAvailable"}');
  });

  test('the key: env var alone, else by slug and by repo name', () => {
    assert.deepEqual(privateKeyCandidates({ envPath: '/k.pem', home: '/h', slug: 'fotos', repoName: 'lilafotos' }), ['/k.pem']);
    assert.deepEqual(privateKeyCandidates({ home: '/h', slug: 'fotos', repoName: 'lilafotos' }), ['/h/.config/fotos-ota/private-key.pem', '/h/.config/lilafotos-ota/private-key.pem']);
    assert.deepEqual(privateKeyCandidates({ home: '/h', slug: 'lilachat', repoName: 'lilachat' }), ['/h/.config/lilachat-ota/private-key.pem']);
  });

  test('content types by extension', () => {
    assert.equal(contentTypeOfExtension('.TTF'), 'font/ttf');
    assert.equal(contentTypeOfExtension('xyz'), 'application/octet-stream');
  });
});

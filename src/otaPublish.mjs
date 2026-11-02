/**
 * `lila ota publish` and `lila ota cert` (0.12.0): OTA updates of Expo apps, hosted by LilaStore.
 *
 * What `scripts/ota-publish.mts` did in Lilachat and Lilafotos, against ONE server for every app:
 * export with the APK build's environment (`lila.json`), check the baked url and the local hosts,
 * sign on this machine, upload, and read back what the server serves before saying it is live.
 *
 * **The private key never leaves this machine** (`OTA_PRIVATE_KEY_PATH`, else
 * `~/.config/<slug>-ota/private-key.pem`). LilaStore keeps the PUBLIC certificate and verifies
 * every signature against it. Neither the key nor the token is ever printed.
 *
 * Runs from the app folder (where `app.json` is), like `apk build`.
 */
import { createHash, createPrivateKey, createPublicKey, createSign, createVerify, randomUUID, X509Certificate } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { rojo, verde, tenue, mb } from './consola.mjs';
import { otaTokenFor, URL_POR_DEFECTO } from './credenciales.mjs';
import { avisarSiHayVersionNueva } from './actualizacion.mjs';
import {
  NO_UPDATE_DIRECTIVE,
  assertBundleBakedUrl,
  assertRuntimeMatches,
  assertUpdatesUrl,
  assetPath,
  buildEnvOf,
  buildManifest,
  countDevHosts,
  manifestUrl,
  privateKeyCandidates,
  rollbackDirective,
} from './ota.mjs';

const EXPORT_DIR = 'dist-ota';
const SNAPSHOT = 'ota-runtime.json';
const UPLOAD_PARALLELISM = 4;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const ROLLBACK_NOW = 'Corre «lila ota publish --embedded» YA.';
const UNAUTHORIZED = 'El token OTA no sirve: inválido, revocado o vencido. Regenéralo en /console/ota y guárdalo con «lila login».';

/** Every failure stops the command with exit 1; the message says what and what to do. */
class Stop extends Error {}
const stop = (message) => {
  throw new Stop(message);
};

const run = (command, args, env) =>
  execFileSync(command, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim();

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

function appConfig() {
  const expo = readJson('app.json')?.expo;
  if (!expo?.slug) stop('No encontré app.json con expo.slug aquí. Corre esto desde la carpeta de la app.');
  return expo;
}

// ---- constroad-gates: the scan for local or test addresses ---------------------------------
const GATES_PLUGIN_DIR = join(homedir(), '.claude/plugins/cache/constroad-skills/constroad-gates');
const GATES_CHECKOUT_SCRIPT = join(homedir(), 'projects/constroad-skills/plugins/constroad-gates/scripts/urls-locales.sh');
const byVersionDescending = (a, b) => b.localeCompare(a, undefined, { numeric: true });

function findUrlsGate() {
  const installed = existsSync(GATES_PLUGIN_DIR)
    ? readdirSync(GATES_PLUGIN_DIR).sort(byVersionDescending).map((version) => join(GATES_PLUGIN_DIR, version, 'scripts/urls-locales.sh'))
    : [];
  const found = [process.env.URLS_LOCALES_GATE, ...installed, GATES_CHECKOUT_SCRIPT].find((candidate) => candidate && existsSync(candidate));
  // A gate silently skipped is not a gate: without the script nothing is published.
  return found ?? stop('No encuentro urls-locales.sh (constroad-gates >= 1.9.0): corre /plugin marketplace update constroad-skills');
}

function assertNoLocalUrlsIn(content, label, whatToDo = 'No se publicó nada.') {
  const folder = mkdtempSync(join(tmpdir(), 'lila-ota-urls-'));
  try {
    const file = join(folder, 'bundle');
    writeFileSync(file, content, typeof content === 'string' ? 'latin1' : undefined);
    const result = spawnSync('bash', [findUrlsGate(), file], { encoding: 'utf8' });
    if (result.status !== 0) stop(`${label} trae direcciones locales o de prueba:\n${result.stdout}${result.stderr}\n${whatToDo}`);
    verde(`${label}: sin direcciones locales ni de prueba`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// ---- inputs ------------------------------------------------------------------------------------
function readBuildEnv() {
  if (!existsSync('lila.json')) stop('Falta lila.json: de ahí sale la URL del server que se hornea en el bundle.');
  try {
    return buildEnvOf(readJson('lila.json'));
  } catch (error) {
    return stop(error.message);
  }
}

/** The shell's environment without its own `EXPO_PUBLIC_*`, plus the APK build's. Expo does not override what is set. */
function exportEnv() {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('EXPO_PUBLIC_')));
  return { ...inherited, ...readBuildEnv() };
}

function gitRoot() {
  try {
    return run('git', ['rev-parse', '--show-toplevel']);
  } catch {
    return stop('Esta carpeta no está en un repositorio git: una publicación sale de main, limpio y empujado.');
  }
}

function checkGit(options) {
  const sha = run('git', ['rev-parse', 'HEAD']);
  if (options.noGitChecks) {
    if (!options.dryRun) stop('--no-git-checks solo se combina con --dry-run: una publicación real sale de main, limpio y empujado.');
    return sha;
  }
  // Tracked changes anywhere may feed the bundle (a shared folder); untracked ones only count inside the app.
  const dirty = [run('git', ['status', '--porcelain', '--untracked-files=no']), run('git', ['status', '--porcelain', '--', '.'])].filter(Boolean).join('\n');
  if (dirty) stop(`Hay cambios sin commitear que pueden entrar al bundle:\n${dirty}`);
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') stop(`Hay que publicar desde main (estás en ${branch}).`);
  run('git', ['fetch', 'origin', 'main', '--quiet']);
  if (sha !== run('git', ['rev-parse', 'origin/main'])) stop('HEAD no es origin/main: empuja (o trae) antes de publicar, para que lo publicado sea lo que está en el repo.');
  return sha;
}

function readPrivateKey(slug) {
  const candidates = privateKeyCandidates({ envPath: process.env.OTA_PRIVATE_KEY_PATH, home: homedir(), slug, repoName: basename(gitRoot()) });
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) stop(`No encuentro la llave privada OTA en ${candidates.join(' ni en ')}. Exporta OTA_PRIVATE_KEY_PATH si está en otro lugar.`);
  return readFileSync(found, 'utf8');
}

const publicKeyDer = (key) => (key.type === 'public' ? key : createPublicKey(key)).export({ type: 'spki', format: 'der' }).toString('base64');

/** The key must be the one behind the certificate inside the APK; a signature of another key is ignored by every phone. */
function assertKeyMatchesCertificate(privateKey, certificatePem, where) {
  let certificateKey;
  try {
    certificateKey = new X509Certificate(certificatePem).publicKey;
  } catch {
    stop(`El certificado de ${where} no se puede leer.`);
  }
  if (publicKeyDer(createPrivateKey(privateKey)) !== publicKeyDer(certificateKey)) {
    stop(`La llave privada no corresponde al certificado de ${where}: los teléfonos ignorarían esta firma.`);
  }
}

function readSnapshot() {
  return readJson(SNAPSHOT) ?? stop(`Falta ${SNAPSHOT}: se escribe después de cada «lila apk build» con «lila ota publish --record-apk=dist/<apk>».`);
}

const resolveRuntime = () => JSON.parse(run('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', 'android'])).runtimeVersion;
const sign = (payload, privateKey) => createSign('RSA-SHA256').update(payload, 'utf8').sign(privateKey, 'base64');

// ---- server ------------------------------------------------------------------------------------
const api = (base, token, method, route, init = {}) =>
  fetch(`${base}${route}`, { method, headers: { authorization: `Bearer ${token}`, ...init.headers }, body: init.body });

async function messageOf(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return `${data.error ?? text.slice(0, 200)}${data.missing ? ` (${data.missing.length} faltan)` : ''}`;
  } catch {
    return text.slice(0, 200);
  }
}

async function failFrom(response, what) {
  if (response.status === 401) stop(UNAUTHORIZED);
  if (response.status === 403) stop('Ese token OTA es de otra app.');
  stop(`${what} (${response.status}): ${await messageOf(response)}`);
}

/**
 * Before two minutes of export: is this token alive, OTA, and of THIS app? `GET /api/v1/token`
 * answers revoked/expired with words once the secret is right; a wrong one is a plain 401.
 */
async function assertTokenUsable(base, token, slug) {
  const response = await fetch(`${base}/api/v1/token`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401) stop(UNAUTHORIZED);
  if (!response.ok) stop(`No pude comprobar el token en ${base} (${response.status}).`);
  const data = await response.json();
  if (data.scope !== 'ota') stop(`Ese es un token de APK (lsp_…): para OTA hace falta uno lota_…, de /console/ota.`);
  if (data.app !== slug) stop(`Ese token OTA es de «${data.app}», no de «${slug}».`);
  if (!data.vigente) stop(`El token OTA de «${slug}» ya no sirve: ${data.motivo === 'revocado' ? 'lo revocaron' : 'venció'}. Regéneralo en /console/ota y guárdalo con «lila login».`);
}

async function serverCertificate(base, slug) {
  const response = await fetch(`${base}/api/v1/apps/${slug}/ota/certificate`);
  if (response.status === 404) stop(`«${slug}» no tiene certificado OTA en ${base}. Súbelo con «lila ota cert ${slug} certs/certificate.crt».`);
  if (!response.ok) stop(`No pude leer el certificado de ${base} (${response.status}).`);
  return (await response.json()).pem;
}

async function uploadAssets(base, token, slug, files) {
  let uploaded = 0;
  const queue = [...files];
  async function worker() {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const route = assetPath(slug, file.sha256);
      const head = await api(base, token, 'HEAD', route);
      if (head.status === 200) continue;
      if (head.status !== 404) await failFrom(head, `HEAD ${file.path}`);
      const response = await api(base, token, 'PUT', route, {
        body: readFileSync(join(EXPORT_DIR, file.path)),
        headers: { 'content-type': 'application/octet-stream', 'x-ota-content-type': file.contentType },
      });
      if (response.status !== 200 && response.status !== 201) await failFrom(response, `PUT ${file.path}`);
      uploaded += 1;
    }
  }
  await Promise.all(Array.from({ length: UPLOAD_PARALLELISM }, worker));
  return uploaded;
}

async function postUpdate(base, token, slug, body) {
  const response = await api(base, token, 'POST', `/api/v1/apps/${slug}/ota/updates`, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  if (response.status !== 201) await failFrom(response, 'El server rechazó la publicación');
  return response.json();
}

/** Reads the manifest the phones get and checks its signature with the certificate: «published» means served and signed. */
async function verifyServed(base, slug, runtimeVersion, id, certificatePem) {
  const response = await fetch(manifestUrl(base, slug), { headers: { 'expo-protocol-version': '1', 'expo-platform': 'android', 'expo-runtime-version': runtimeVersion } });
  const body = await response.text();
  if (response.status !== 200 || !body.includes(id)) stop(`Publicado, pero el server no sirve este manifest (${response.status}). Revísalo antes de decir que está en vivo.`);
  const signature = /expo-signature: sig="([^"]+)"/.exec(body)?.[1];
  const part = /\r\n\r\n(\{[\s\S]*?\})\r\n--/.exec(body)?.[1];
  const valid = signature && part && createVerify('RSA-SHA256').update(part, 'utf8').verify(certificatePem, signature, 'base64');
  if (!valid) stop(`El manifest que sirve el server no verifica con el certificado de la app. ${ROLLBACK_NOW}`);
}

// ---- commands ----------------------------------------------------------------------------------
function recordApk(apkPath) {
  const apk = resolve(apkPath);
  if (!existsSync(apk)) stop(`No encuentro el APK en ${apk}.`);
  const bundle = execFileSync('unzip', ['-p', apk, 'assets/index.android.bundle'], { encoding: 'latin1', maxBuffer: MAX_BUNDLE_BYTES });
  const apiUrl = readBuildEnv().EXPO_PUBLIC_API_URL;
  const devHosts = countDevHosts(bundle);
  if (!bundle.includes(apiUrl)) stop(`El APK no trae ${apiUrl} en su bundle: no lo publiques.`);
  if (devHosts['10.0.2.2']) stop('El bundle del APK trae 10.0.2.2: tiene una URL de desarrollo horneada, no lo publiques.');
  assertNoLocalUrlsIn(bundle, 'El bundle del APK');
  const snapshot = { versionCode: appConfig().android?.versionCode ?? null, runtimeVersion: resolveRuntime(), devHosts };
  writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
  verde(`Anotado el APK ${snapshot.versionCode}: runtime ${snapshot.runtimeVersion.slice(0, 8)}, hosts de desarrollo ${JSON.stringify(devHosts)}`);
  return 0;
}

async function publishRollback({ base, token, slug, privateKey, dryRun }) {
  const snapshot = readSnapshot();
  const directive = rollbackDirective(new Date());
  console.log(`Vuelta al código del APK ${snapshot.versionCode} (runtime ${snapshot.runtimeVersion.slice(0, 8)})`);
  if (dryRun) return verde('--dry-run: no se sube nada.');
  const { id } = await postUpdate(base, token, slug, { runtimeVersion: snapshot.runtimeVersion, directive, signature: sign(directive, privateKey), noUpdateSignature: sign(NO_UPDATE_DIRECTIVE, privateKey) });
  return verde(`Publicada la vuelta al APK (${id.slice(0, 8)}): los teléfonos vuelven al código de su APK en su próxima revisión.`);
}

async function publishUpdate({ base, token, slug, privateKey, certificatePem, gitSha, dryRun }) {
  const snapshot = readSnapshot();
  if (!snapshot.devHosts) stop(`Falta devHosts en ${SNAPSHOT} (la línea base del bundle del APK): corre --record-apk=dist/<apk>.`);
  tenue('Resolviendo el runtime…');
  const runtimeVersion = resolveRuntime();
  try {
    assertRuntimeMatches(runtimeVersion, snapshot);
  } catch (error) {
    stop(error.message);
  }
  const env = exportEnv();
  const apiUrl = env.EXPO_PUBLIC_API_URL;
  rmSync(EXPORT_DIR, { recursive: true, force: true });
  tenue('Exportando el bundle de android (un par de minutos)…');
  // `--clear`: Metro's transform cache does not key on `EXPO_PUBLIC_*` (Lilachat, 25/10/2026).
  run('npx', ['expo', 'export', '--platform', 'android', '--output-dir', EXPORT_DIR, '--clear'], env);
  const metadata = readJson(join(EXPORT_DIR, 'metadata.json')) ?? stop(`expo export no dejó ${EXPORT_DIR}/metadata.json.`);
  const android = metadata.fileMetadata.android;
  const bundleText = readFileSync(join(EXPORT_DIR, android.bundle), 'latin1');
  try {
    assertBundleBakedUrl(bundleText, { apiUrl, baseline: snapshot.devHosts });
  } catch (error) {
    stop(`${error.message}. No se publicó nada.`);
  }
  assertNoLocalUrlsIn(bundleText, 'El bundle exportado');

  const paths = [android.bundle, ...android.assets.map((asset) => asset.path)];
  const digests = Object.fromEntries(
    paths.map((file) => {
      const bytes = readFileSync(join(EXPORT_DIR, file));
      return [file, { sha256: createHash('sha256').update(bytes).digest('base64url'), md5: createHash('md5').update(bytes).digest('hex') }];
    })
  );
  const expoClient = JSON.parse(run('npx', ['expo', 'config', '--type', 'public', '--json'], env));
  const manifest = buildManifest({ id: randomUUID(), createdAt: new Date().toISOString(), runtimeVersion, metadata, digests, base, slug, expoClient, gitSha });
  const manifestText = JSON.stringify(manifest);
  const summary = `${manifest.id}  runtime ${runtimeVersion.slice(0, 8)}  git ${gitSha.slice(0, 7)}  bundle ${mb(Buffer.byteLength(bundleText, 'latin1'))}  ${android.assets.length} assets`;
  if (dryRun) {
    verde('--dry-run: no se sube nada.');
    console.log(summary);
    return 0;
  }

  const files = [manifest.launchAsset, ...manifest.assets].map((asset, index) => ({ path: paths[index], sha256: asset.hash, contentType: asset.contentType }));
  tenue(`Subiendo ${files.length} archivos a ${base}…`);
  const uploaded = await uploadAssets(base, token, slug, files);
  await postUpdate(base, token, slug, { runtimeVersion, manifest: manifestText, signature: sign(manifestText, privateKey), noUpdateSignature: sign(NO_UPDATE_DIRECTIVE, privateKey) });

  tenue('Verificando lo que sirve el server…');
  await verifyServed(base, slug, runtimeVersion, manifest.id, certificatePem);
  // What phones will download, not what was exported: the bundle as the server serves it.
  const served = Buffer.from(await (await fetch(`${base}${assetPath(slug, manifest.launchAsset.hash)}`)).arrayBuffer());
  try {
    assertBundleBakedUrl(served.toString('latin1'), { apiUrl, baseline: snapshot.devHosts });
  } catch (error) {
    stop(`El bundle que sirve el server NO pasa la guardia: ${error.message}. ${ROLLBACK_NOW}`);
  }
  assertNoLocalUrlsIn(served, 'El bundle que sirve el server', ROLLBACK_NOW);
  verde(`Publicado y verificado en vivo (${uploaded} archivos nuevos)`);
  console.log(summary);
  return 0;
}

export async function otaPublish(options) {
  try {
    if (options.recordApk) return recordApk(options.recordApk);
    const expo = appConfig();
    const slug = expo.slug;
    const base = (options.url ?? URL_POR_DEFECTO).replace(/\/+$/, '');
    console.log(`lila ota publish${options.embedded ? ' --embedded' : ''}`);
    console.log(`  app     : ${slug}`);
    console.log(`  destino : ${base}`);

    // Before anything slow: an APK that asks another server would never see this.
    try {
      assertUpdatesUrl(expo, base, slug);
    } catch (error) {
      stop(error.message);
    }
    const gitSha = options.embedded ? run('git', ['rev-parse', 'HEAD']) : checkGit(options);
    const picked = otaTokenFor(slug);
    if (!picked.token && !options.dryRun) stop(picked.reason);
    if (picked.token) {
      console.log(`  token   : ${picked.origin}`);
      await assertTokenUsable(base, picked.token, slug);
    }

    const privateKey = readPrivateKey(slug);
    const localCertificate = readFileSync(resolve(expo.updates.codeSigningCertificate), 'utf8');
    assertKeyMatchesCertificate(privateKey, localCertificate, 'app.json (el que viaja en el APK)');
    const certificatePem = await serverCertificate(base, slug);
    assertKeyMatchesCertificate(privateKey, certificatePem, `«${slug}» en LilaStore`);

    const context = { base, token: picked.token, slug, privateKey, certificatePem, gitSha, dryRun: options.dryRun };
    return options.embedded ? await publishRollback(context) : await publishUpdate(context);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    rojo(error.message);
    await avisarSiHayVersionNueva();
    return 1;
  }
}

export async function otaCert(slug, file, options) {
  if (!slug || !file) return rojo('Uso: lila ota cert <slug> <certificate.pem>');
  if (!existsSync(file)) return rojo(`No encuentro ${file}.`);
  const text = readFileSync(file, 'utf8');
  if (/PRIVATE KEY-----/.test(text)) return rojo('Ese archivo es la llave PRIVADA: nunca sale de tu máquina. Aquí va el certificado público.');
  const picked = otaTokenFor(slug);
  if (!picked.token) return rojo(picked.reason);
  const base = (options.url ?? URL_POR_DEFECTO).replace(/\/+$/, '');
  let response;
  try {
    response = await api(base, picked.token, 'PUT', `/api/v1/apps/${slug}/ota/certificate`, { body: text, headers: { 'content-type': 'application/x-pem-file' } });
  } catch (error) {
    return rojo(`No se pudo contactar a ${base}: ${error.message}`);
  }
  if (response.status === 401) return rojo(UNAUTHORIZED);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return rojo(`${response.status} ${data.codigo ?? ''} — ${data.error ?? 'sin detalle'}`);
  verde(data.changed ? `Certificado OTA de «${slug}» registrado.` : `«${slug}» ya tenía este certificado: no cambió nada.`);
  console.log(`  huella : ${data.fingerprint}`);
  return 0;
}

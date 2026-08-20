import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { sirveAUnTelefono, urlsDeclaradas } from './urls.mjs';

describe('urlsDeclaradas', () => {
  // El bug: devolvía LA PRIMERA. Timón declara dos —el Portal y la tienda— así
  // que la segunda se compilaba sin que nadie comprobara que quedó adentro.
  test('devuelve TODAS, no la primera', () => {
    const declaradas = urlsDeclaradas({
      EXPO_PUBLIC_API_URL: 'https://www.constroad.com',
      EXPO_PUBLIC_STORE_URL: 'https://lilastore.constroad.com',
    });

    assert.deepEqual(declaradas, [
      ['EXPO_PUBLIC_API_URL', 'https://www.constroad.com'],
      ['EXPO_PUBLIC_STORE_URL', 'https://lilastore.constroad.com'],
    ]);
  });

  test('solo las `EXPO_PUBLIC_*`: son las únicas que Expo hornea', () => {
    // Una variable que no empieza así no llega al bundle, y buscarla adentro del
    // APK daría un fallo sobre algo que nunca debió estar.
    const declaradas = urlsDeclaradas({
      API_URL: 'https://no-se-hornea.com',
      EXPO_PUBLIC_API_URL: 'https://si.com',
    });

    assert.deepEqual(declaradas, [['EXPO_PUBLIC_API_URL', 'https://si.com']]);
  });

  test('lo que no es una URL no se verifica', () => {
    assert.deepEqual(urlsDeclaradas({ EXPO_PUBLIC_MODO: 'produccion' }), []);
    assert.deepEqual(urlsDeclaradas({}), []);
  });
});

describe('sirveAUnTelefono', () => {
  test('un host público con https sí', () => {
    assert.equal(sirveAUnTelefono('https://lilastore.constroad.com'), true);
    assert.equal(sirveAUnTelefono('https://www.constroad.com/api'), true);
  });

  // El emulador. Un release compilado con el `.env` de desarrollo se instala
  // perfecto y falla en la mano del chofer con «sin conexión» y el wifi andando.
  test('el emulador y localhost, no', () => {
    assert.equal(sirveAUnTelefono('http://10.0.2.2:4001'), false);
    assert.equal(sirveAUnTelefono('http://localhost:3000'), false);
    assert.equal(sirveAUnTelefono('https://mi-mac.local'), false);
  });

  // Tailscale es el peor caso porque **la subida funciona**: el host existe y
  // responde desde esta máquina. Lo que queda mal es lo que se guardó, y se
  // descubre recién en el teléfono de otra persona.
  test('la Tailnet, no', () => {
    assert.equal(sirveAUnTelefono('https://cloud-constroad-s3.tail46a1b0.ts.net'), false);
  });

  test('las IP privadas, no', () => {
    for (const url of [
      'https://192.168.1.50',
      'https://10.1.2.3',
      'https://172.16.0.1',
      'https://172.31.255.1',
      'https://127.0.0.1',
    ]) {
      assert.equal(sirveAUnTelefono(url), false, url);
    }
  });

  // 172.32 ya está fuera del rango privado (172.16–172.31). Un rechazo de más
  // acá bloquearía un release legítimo por una regla escrita a ojo.
  test('172.32 NO es privada', () => {
    assert.equal(sirveAUnTelefono('https://172.32.0.1'), true);
  });

  test('http sin cifrar tampoco, aunque el host sea público', () => {
    // Android bloquea el tráfico en claro en release desde el API 28: el APK se
    // compila, se instala, y cada request falla sin decir por qué.
    assert.equal(sirveAUnTelefono('http://www.constroad.com'), false);
  });

  test('lo que no se puede parsear se rechaza', () => {
    assert.equal(sirveAUnTelefono('no-es-una-url'), false);
    assert.equal(sirveAUnTelefono(''), false);
  });
});

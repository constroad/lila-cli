import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debeCaerAlPost } from './publish.mjs';

test('cae al POST solo cuando el server no tiene el endpoint de tus', () => {
  // 404/501 = LilaStore viejo, sin la ruta: el POST clásico sí funciona.
  assert.equal(debeCaerAlPost(404), true);
  assert.equal(debeCaerAlPost(501), true);
});

test('un rechazo del server NO cae al POST: es una decisión tomada', () => {
  for (const status of [401, 409, 413, 422, 201, 400, 500]) {
    assert.equal(debeCaerAlPost(status), false, `status ${status} no debería caer al POST`);
  }
});

test('sin status (fallo de red) no cae al POST — tus ya reintentó su parte', () => {
  assert.equal(debeCaerAlPost(null), false);
  assert.equal(debeCaerAlPost(undefined), false);
});

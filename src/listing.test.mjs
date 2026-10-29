import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listingBody, listingFailure } from './listing.mjs';

describe('listingBody', () => {
  it('takes the summary and the description from the app repo file', () => {
    assert.deepEqual(listingBody('{"summary":"Inglés desde cero","description":"Lila enseña."}'), { body: { summary: 'Inglés desde cero', description: 'Lila enseña.' } });
  });

  it('sends an empty description, never a missing one (the server would keep the old text)', () => {
    assert.deepEqual(listingBody('{"summary":"Algo","description":""}').body, { summary: 'Algo', description: '' });
    assert.match(listingBody('{"summary":"Algo"}').error, /description/);
  });

  it('refuses a file that is not a JSON object with both texts', () => {
    assert.match(listingBody('no es json').error, /JSON/);
    assert.match(listingBody('[1,2]').error, /objeto|object/i);
    assert.match(listingBody('{"summary":3,"description":"x"}').error, /summary/);
  });
});

describe('listingFailure', () => {
  it('lists every field the server rejected', () => {
    const message = listingFailure(422, { codigo: 'datos_invalidos', errores: { summary: 'Entre 1 y 80 caracteres.', description: 'Hasta 4000.' } });
    assert.match(message, /summary: Entre 1 y 80/);
    assert.match(message, /description: Hasta 4000/);
  });

  it('keeps the server code and text for any other refusal', () => {
    assert.equal(listingFailure(403, { codigo: 'otra_app', error: 'Ese token es de otra app.' }), '403 otra_app — Ese token es de otra app.');
  });
});

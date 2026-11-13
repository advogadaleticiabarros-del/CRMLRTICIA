// Pedido (13/11/2026): "quero poder incluir isso no card dos dativos" — na ficha
// da demanda dativa, as seções Relatos e Audiências só mostravam a lista; não
// dava para incluir dali. Cada seção ganha "+ Incluir", e a audiência já nasce
// ligada à demanda aberta (sem escolher numa lista).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
const ini = src.indexOf('async function dativeCaseDetail(');
const ficha = src.slice(ini, src.indexOf('async function dativeHearingForm(', ini));
const iniForm = src.indexOf('async function dativeHearingForm(');
const formAud = src.slice(iniForm, src.indexOf('async function dativePaymentForm(', iniForm));

test('ficha do dativo: botões de incluir relato e audiência nas próprias seções', () => {
  assert.match(ficha, /data-dat-add="relato"/);
  assert.match(ficha, /data-dat-add="audiencia"/);
});

test('ficha do dativo: incluir audiência passa a demanda aberta e reabre a ficha', () => {
  assert.match(ficha, /dativeHearingForm\(\(\) => dativeCaseDetail\(id, onSave\), d\)/);
});

test('nova audiência vinda da ficha usa a demanda dela (campo oculto), sem pedir a lista', () => {
  assert.match(formAud, /async function dativeHearingForm\(onSave, caso\)/);
  assert.match(formAud, /type="hidden" name="dative_case_id"/);
});

test('documentos continuam na ficha do dativo', () => {
  assert.match(ficha, /dativeDocsSection\(id, d\.client_id/);
});

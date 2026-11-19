// Liberar a TV do escritório pelo celular (/tv/liberar) — 19/11/2026.
// Usa o login do CRM que já está neste celular (crm_token).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var token = null;
  try { token = localStorage.getItem('crm_token'); } catch (e) { /* sem armazenamento */ }
  var params = new URLSearchParams(location.search);
  var codigoUrl = (params.get('codigo') || '').replace(/\D/g, '').slice(0, 6);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function quando(iso) { return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—'; }

  function semLogin() {
    $('semLogin').hidden = false; $('comLogin').hidden = true; $('lista').hidden = true;
  }
  $('irLogin').onclick = function () {
    try { localStorage.setItem('tv_voltar', '/tv/liberar' + (codigoUrl ? '?codigo=' + codigoUrl : '')); } catch (e) { /* segue */ }
    location.href = '/';
  };

  function api(caminho, corpo) {
    return fetch(caminho, {
      method: corpo ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: corpo ? JSON.stringify(corpo) : undefined,
    }).then(function (r) {
      var novo = r.headers.get('X-Renew-Token');
      if (novo) { token = novo; try { localStorage.setItem('crm_token', novo); } catch (e) { /* segue */ } }
      if (r.status === 401) { semLogin(); throw new Error('Entre no CRM de novo.'); }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Não deu certo. Tente de novo.'); return d; });
    });
  }

  function carregarLista() {
    api('/api/tv-aparelhos').then(function (tvs) {
      $('tvs').innerHTML = tvs.length ? tvs.map(function (t) {
        return '<div class="tv"><div><b>' + esc(t.nome) + '</b><small>Liberada em ' + quando(t.liberadaEm) + ' · último uso ' + quando(t.ultimoUso) + '</small></div>' +
          '<button type="button" data-desligar="' + t.id + '">Desligar</button></div>';
      }).join('') : '<p class="vazio">Nenhuma TV liberada ainda.</p>';
    }).catch(function (e) { $('tvs').innerHTML = '<p class="vazio">' + esc(e.message) + '</p>'; });
  }
  $('tvs').addEventListener('click', function (e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-desligar');
    if (!id || !confirm('Desligar esta TV? Ela vai voltar a pedir um código.')) return;
    api('/api/tv-aparelhos/' + id + '/desligar', {}).then(carregarLista).catch(function (err) { alert(err.message); });
  });

  $('form').onsubmit = function (e) {
    e.preventDefault();
    var msg = $('msg'), botao = $('liberar');
    msg.className = 'msg'; botao.disabled = true; botao.textContent = 'Liberando…';
    api('/api/tv-aparelhos/liberar', { codigo: $('codigo').value, nome: $('nome').value }).then(function () {
      msg.className = 'msg ok'; msg.textContent = 'Pronto! A TV abre o painel sozinha em alguns segundos.';
      $('codigo').value = '';
      carregarLista();
    }).catch(function (err) {
      msg.className = 'msg erro'; msg.textContent = err.message;
    }).then(function () { botao.disabled = false; botao.textContent = 'Liberar a TV'; });
  };

  if (!token) { semLogin(); return; }
  $('comLogin').hidden = false; $('lista').hidden = false;
  $('codigo').value = codigoUrl;
  (codigoUrl ? $('nome') : $('codigo')).focus();
  carregarLista();
})();

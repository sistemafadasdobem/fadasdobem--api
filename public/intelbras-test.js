/* global sessionStorage, localStorage, fetch, URLSearchParams, document, window, console */
(function () {
  'use strict';

  var STORAGE_API = 'intelbrasTestApiRoot';
  var STORAGE_SECRET = 'intelbrasTestLabSecret';
  var API_BASE = '';

  function $(id) {
    return document.getElementById(id);
  }

  var logEl = $('log');
  var localStream = null;

  function parseApiRootInput(raw) {
    var s = String(raw || '').trim().replace(/\/$/, '');
    if (!s) return '';
    if (/\/api\/v1$/i.test(s)) return s.slice(0, -'/api/v1'.length);
    return s;
  }

  function normalizeToApiV1(root) {
    root = String(root || '').trim().replace(/\/$/, '');
    if (!root) return '';
    if (/\/api\/v1$/i.test(root)) return root;
    return root + '/api/v1';
  }

  function resolveApiBase() {
    var params = new URLSearchParams(window.location.search || '');
    var fromQuery = parseApiRootInput(params.get('api') || params.get('apiBase') || '');
    if (fromQuery) return normalizeToApiV1(fromQuery);

    var fromInput = parseApiRootInput($('apiRoot').value);
    if (fromInput) return normalizeToApiV1(fromInput);

    try {
      var stored = sessionStorage.getItem(STORAGE_API);
      if (stored) return normalizeToApiV1(parseApiRootInput(stored));
    } catch (_e) {}

    if (window.location.protocol === 'file:') return '';

    var o = window.location.origin;
    if (o && o !== 'null' && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
      return normalizeToApiV1(o);
    }
    return '';
  }

  function apiUrl(subPath) {
    var p = subPath.startsWith('/') ? subPath : '/' + subPath;
    return API_BASE + p;
  }

  function log(msg) {
    if (!logEl) return;
    var t = new Date().toISOString().slice(11, 23);
    logEl.textContent += '[' + t + '] ' + msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[intelbras-test]', msg);
  }

  function labHeaders() {
    var h = { Accept: 'application/json' };
    var sec = $('labSecret').value.trim();
    if (sec) h['x-telecom-lab-secret'] = sec;
    return h;
  }

  function describeFetchError(err) {
    var m = (err && err.message) || String(err);
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
      return (
        m +
        ' — CORS/rede ou URL errada. Serve a página pelo Express (mesma origem) ou preenche «Raiz da API» com http(s)://host:porta.'
      );
    }
    return m;
  }

  function pretty(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }

  function setLabStatus(text, kind) {
    var el = $('labStatus');
    if (!el) return;
    el.textContent = text;
    el.className = kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : '';
  }

  function setDefaultsBanner(text, kind) {
    var el = $('defaultsStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color =
      kind === 'ok'
        ? '#86efac'
        : kind === 'err'
          ? '#fecaca'
          : '#bbd4e8';
  }

  function renderDestinoVariants(variants) {
    var wrap = $('destinoVariantsWrap');
    var btns = $('destinoVariantsBtns');
    if (!wrap || !btns) return;
    variants = variants && variants.length ? variants : [];
    btns.innerHTML = '';
    if (!variants.length) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    variants.forEach(function (digits) {
      var d = String(digits || '').replace(/\D/g, '');
      if (d.length < 10) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary';
      b.style.fontSize = '0.72rem';
      b.style.padding = '4px 8px';
      b.style.marginBottom = '4px';
      b.textContent = '…' + d.slice(-4);
      b.title = d;
      b.addEventListener('click', function () {
        $('destino').value = d;
        log('Destino = variante E.164/nacional: ' + d);
      });
      btns.appendChild(b);
    });
  }

  function refreshApiBase() {
    API_BASE = resolveApiBase();
    log('API_BASE = ' + (API_BASE || '(vazio — preenche «Raiz da API» ou abre via http://servidor/intelbras-test.html)'));
    return API_BASE;
  }

  function silentRefreshApiBase() {
    API_BASE = resolveApiBase();
    return API_BASE;
  }

  async function loadLabDefaultsIntoForm() {
    var stEl = $('defaultsStatus');
    if (!API_BASE && stEl) {
      renderDestinoVariants([]);
      setDefaultsBanner(
        'Define «Raiz da API» ou abre em http(s):// mesmo host que a API.',
        'err'
      );
      return;
    }
    if (stEl) setDefaultsBanner('A pedir GET /telecom/lab/defaults …', '');

    try {
      var res = await fetch(apiUrl('/telecom/lab/defaults'), {
        method: 'GET',
        headers: labHeaders(),
        credentials: 'omit',
        mode: 'cors',
      });
      var j = await res.json().catch(function () {
        return {};
      });

      log('GET /telecom/lab/defaults → HTTP ' + res.status);

      if (res.ok && j.sucesso && j.dados) {
        $('origem').value = j.dados.origem || '';
        $('destino').value = j.dados.destino || '';
        renderDestinoVariants(j.dados.destino_variantes || []);
        if (j.dados.pronto_um_clique) {
          setDefaultsBanner(
            'Pronto: ramal «' +
              j.dados.origem +
              '» → destino (termina …' +
              String(j.dados.destino_digitos || '').slice(-4) +
              '). Segue para «Demo em 1 clique».',
            'ok'
          );
        } else if (j.dados.ajuda_destino) {
          setDefaultsBanner(j.dados.ajuda_destino, 'err');
        } else {
          setDefaultsBanner(
            j.dados.falta_origem
              ? 'Sem ramal: corre npm run seed:homolog ou INTELBRAS_LAB_ORIGEM_RAMAL.'
              : 'Destino incompleto: INTELBRAS_LAB_DESTINO ou seed com telefone real.',
            'err'
          );
        }
      } else {
        renderDestinoVariants([]);
        log(pretty(j));
        setDefaultsBanner((j && j.mensagem) || 'Erro ao ler /telecom/lab/defaults.', 'err');
      }
    } catch (e) {
      renderDestinoVariants([]);
      setDefaultsBanner(describeFetchError(e), 'err');
      log('defaults: ' + describeFetchError(e));
    }
  }

  async function runDemoOneClick() {
    refreshApiBase();
    if (!API_BASE) {
      setDefaultsBanner('Sem API_BASE — configura Raiz ou abre no servidor.', 'err');
      log('ERRO: API_BASE vazio antes do demo.');
      return;
    }
    var btn = $('btnDemoOneClick');
    if (btn) btn.disabled = true;
    log('━━━━━━━━ POST /telecom/lab/run-demo (corpo vazio · servidor usa BD + .env)');
    try {
      var pack = await fetchJson('POST', '/telecom/lab/run-demo', {});
      log('HTTP ' + pack.res.status + '\n' + pretty(pack.json));
      if (pack.json && pack.json.sucesso && pack.json.dados && pack.json.dados.call_id) {
        log('>>> ✓ ID da chamada: ' + pack.json.dados.call_id);
      }
    } catch (e) {
      log('ERRO: ' + describeFetchError(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function fetchJson(method, path, body) {
    var url = apiUrl(path);
    var opts = {
      method: method,
      headers: Object.assign({}, labHeaders(), { 'Content-Type': 'application/json' }),
      credentials: 'omit',
      mode: 'cors',
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var res = await fetch(url, opts);
    var json = null;
    try {
      json = await res.json();
    } catch (_e) {
      json = { _parseError: 'Resposta não-JSON', status: res.status };
    }
    return { res: res, json: json };
  }

  function showFileWarning() {
    if (window.location.protocol !== 'file:') return;
    var el = $('fileWarning');
    if (el) el.style.display = 'block';
    log('AVISO: abriste este ficheiro em file:// — o browser bloqueia chamadas à API. Usa: npm start e abre http://localhost:PORTA/intelbras-test.html');
  }

  function init() {
    if (!$('log') || !$('btnPingLab') || !$('btnDemoOneClick')) {
      console.error('[intelbras-test] DOM incompleto.');
      return;
    }

    $('hintUrl').textContent =
      window.location.origin && window.location.protocol !== 'file:'
        ? window.location.origin + '/intelbras-test.html'
        : '/intelbras-test.html (servido pelo Express em http://localhost:PORT)';

    try {
      var s = sessionStorage.getItem(STORAGE_API);
      if (s) $('apiRoot').value = s;
      var sc = sessionStorage.getItem(STORAGE_SECRET);
      if (sc) $('labSecret').value = sc;
    } catch (_e) {}

    showFileWarning();

    $('btnSaveConfig').addEventListener('click', async function () {
      try {
        sessionStorage.setItem(STORAGE_API, $('apiRoot').value.trim());
        sessionStorage.setItem(STORAGE_SECRET, $('labSecret').value);
      } catch (e) {
        log('sessionStorage falhou: ' + e);
      }
      refreshApiBase();
      log('Config guardada no navegador (sessionStorage).');
      if (!$('apiRoot').value.trim() && window.location.protocol === 'file:') {
        setLabStatus('Em file:// indica a raiz da API (ex: http://localhost:3000) e guarda de novo.', 'err');
      }
      await loadLabDefaultsIntoForm();
    });

    $('btnReloadDefaults').addEventListener('click', async function () {
      refreshApiBase();
      await loadLabDefaultsIntoForm();
    });

    $('btnDemoOneClick').addEventListener('click', function () {
      runDemoOneClick();
    });

    $('btnPingLab').addEventListener('click', async function () {
      refreshApiBase();
      if (!API_BASE) {
        var msg =
          'Sem URL da API. Preenche «Raiz da API» (ex: http://localhost:3000) e clica Guardar, ou abre a página já no servidor.';
        setLabStatus(msg, 'err');
        log('ERRO: ' + msg);
        return;
      }
      try {
        log('GET ' + apiUrl('/telecom/lab/ping'));
        var r = await fetch(apiUrl('/telecom/lab/ping'), {
          method: 'GET',
          headers: labHeaders(),
          credentials: 'omit',
          mode: 'cors',
        });
        var j = await r.json().catch(function () {
          return {};
        });
        log('HTTP ' + r.status + '\n' + pretty(j));
        if (r.ok && j.sucesso) {
          var preview =
            j.dados && j.dados.widevoice_base_preview ? j.dados.widevoice_base_preview : 'ok';
          setLabStatus('Laboratório ativo — WideVoice base: ' + preview, 'ok');
        } else {
          setLabStatus('Falha ping: HTTP ' + r.status + ' — ' + (j.mensagem || ''), 'err');
        }
      } catch (e) {
        setLabStatus(describeFetchError(e), 'err');
        log('ERRO: ' + describeFetchError(e));
      }
    });

    $('btnCall').addEventListener('click', async function () {
      refreshApiBase();
      if (!API_BASE) {
        log('ERRO: API_BASE vazio — configura «Raiz da API».');
        setLabStatus('Preenche a raiz da API.', 'err');
        return;
      }
      var origem = $('origem').value.trim();
      var destino = $('destino').value.trim();
      if (!origem || !destino) {
        log('ERRO: preenche origem (ramal) e destino (telefone).');
        return;
      }
      try {
        log('POST /telecom/lab/clicktocall ' + pretty({ origem: origem, destino: destino }));
        var pack = await fetchJson('POST', '/telecom/lab/clicktocall', { origem: origem, destino: destino });
        log('HTTP ' + pack.res.status + '\n' + pretty(pack.json));
        if (pack.json && pack.json.sucesso && pack.json.dados) {
          var id = pack.json.dados.call_id;
          if (id) log('>>> ID chamada (central): ' + id);
          var flat = pack.json.dados.widevoice_flat;
          if (flat && flat.Status) log('>>> Status tuple: ' + flat.Status);
        }
      } catch (e) {
        log('ERRO: ' + describeFetchError(e));
      }
    });

    $('btnRelease').addEventListener('click', async function () {
      refreshApiBase();
      var ramal = $('origem').value.trim();
      if (!ramal) {
        log('ERRO: preenche origem (ramal).');
        return;
      }
      try {
        log('POST /telecom/lab/liberarramal ' + pretty({ ramal: ramal }));
        var pack = await fetchJson('POST', '/telecom/lab/liberarramal', { ramal: ramal });
        log('HTTP ' + pack.res.status + '\n' + pretty(pack.json));
      } catch (e) {
        log('ERRO: ' + describeFetchError(e));
      }
    });

    $('btnStatus').addEventListener('click', async function () {
      refreshApiBase();
      if (!API_BASE) {
        log('ERRO: API_BASE vazio.');
        return;
      }
      try {
        log('POST /telecom/lab/statusramais {}');
        var pack = await fetchJson('POST', '/telecom/lab/statusramais', {});
        log('HTTP ' + pack.res.status + '\n' + pretty(pack.json));
      } catch (e) {
        log('ERRO: ' + describeFetchError(e));
      }
    });

    $('btnCam').addEventListener('click', async function () {
      var vid = $('vidLocal');
      var ph = $('phLocal');
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        vid.srcObject = localStream;
        vid.style.display = 'block';
        ph.style.display = 'none';
        await vid.play().catch(function () {});
        log('Câmara local ligada (só para teste visual).');
      } catch (e) {
        log('Câmara: ' + ((e && e.message) || e));
      }
    });

    $('btnCamStop').addEventListener('click', function () {
      var vid = $('vidLocal');
      var ph = $('phLocal');
      if (localStream) {
        localStream.getTracks().forEach(function (t) {
          t.stop();
        });
        localStream = null;
      }
      vid.srcObject = null;
      vid.style.display = 'none';
      ph.style.display = 'flex';
      log('Câmara local parada.');
    });

    silentRefreshApiBase();
    log(
      'Pronto · API_BASE=' +
        (API_BASE || 'vazio (file:// ou porta errada)') +
        ' · A carregar ramal/telemóvel do servidor (/telecom/lab/defaults)…'
    );
    loadLabDefaultsIntoForm();
    log('Depois que o texto verde aparecer por baixo do botão grande, clicar «Demo em 1 clique».');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

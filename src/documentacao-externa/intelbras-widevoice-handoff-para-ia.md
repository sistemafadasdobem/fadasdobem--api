    # Handoff: Intelbras WideVoice + API Node (Fadas do Bem)

    Documento para **assistente IA / suporte técnico externo** — descreve integração real no repositório, contrato HTTP, variáveis de ambiente e comportamento observado. **Não** colar aqui `login`/`token` reais da conta; usar placeholders.

    ---

    ## 1. Contexto do produto

    - **Backend:** Node.js + Express.
    - **Telefonia cloud:** Intelbras **WideVoice** (host típico SaaS `*.intelbrasvoice.com.br`), endpoint **`POST /api.php`** com corpo **JSON**.
    - **Objetivo da integração:** `clicktocall` (origem = ramal na central, destino = telefone do cliente), mais `liberarramal`, `statusramais`, `statusoperacoes`, `statusreport`, `desligar` opcional.
    - **Problema operacional histórico:** resposta HTTP **200** com **`CHAMADA OK`** e **ID** na API, mas **telemóvel não tocava** ou fluxo incompleto — indício de **configuração PBX / permissão de ramal / formato de discagem / fluxo “tocar no ramal primeiro”**, não de falha Axios básica.

    ### Notas do parceiro Intelbras (informais)

    - Ramais de **atendimento** com permissão de **originar chamada** foram indicados (**0560**, **0561**, **0562** — nomenclatura “Atendimento02–04”).
    - Perfis devem usar **função “Telefonista”** (menu após login no painel WideVoice), quando aplicável à conta — **não** é parâmetro do JSON `clicktocall`.
    - O manual público Às vezes usa host genérico `widevoice.intelbras.com.br`; **esta conta usa subdomínio dedicado** (exemplo de padrão: `https://CLIENTE.intelbrasvoice.com.br`). Credenciais e host são **ligados**.

    ---

    ## 2. Árvore de ficheiros relevantes

    | Caminho | Papel |
    |--------|------|
    | `src/providers/intelbras/intelbras.service.js` | Axios, `wideVoiceAction`, `clickToCall`, parse de respostas texto/JSON/HTML, `hangupSessionMedia`. |
    | `src/providers/intelbras/intelbras.client.js` | Re-export fino para o resto da app. |
    | `src/utils/widevoiceDialPlan.util.js` | Normalização brasileira do campo **`destino`** antes do `POST`. |
    | `src/features/telecom/telecom.lab.controller.js` | Endpoints HTTP de laboratório (`run-demo`, `clicktocall`, …). |
    | `src/features/telecom/telecom.lab.routes.js` | Rotas sob `/api/v1/telecom/lab/*` (middleware). |
    | `src/features/telecom/telecom.widevoice-probe.routes.js` | `GET /api/v1/telecom/widevoice-check` (probe público). |
    | `src/features/telecom/telecom.lab.defaults.helper.js` | Resolve par origem/destino (env + BD seed homolog); `destino_variantes`. |
    | `src/middlewares/telecom.lab.middleware.js` | Gate `INTELBRAS_TELECOM_LAB_ENABLED` (+ segredo opcional). |
    | `public/intelbras-test.html` + `public/intelbras-test.js` | UI homolog chamando o lab. |
    | `src/documentacao/providers/Intelbras.md` | Notas DEV (perfil telefonista, ramal autorizado). |
    | `.env.example` | Lista das variáveis (sem valores secretos). |

    **Montagem de rotas** (`src/routes/index.js`):

    - `/api/v1/telecom` → probe público + lab.

    ---

    ## 3. Contrato HTTP WideVoice (implementado)

    Montagem do body em `wideVoiceAction` — **`extra`** (campos específicos da ação) vem primeiro; depois **`acao`**, **`login`**, **`token`** para não sobrescrever credenciais:

    ```javascript
    const body = {
      ...extra,
      acao,
      login,
      token,
    };
    await client.post(apiPath, body, { responseType: 'text', ... });
    ```

    ### Exemplo equiparável ao manual Intelbras (`clicktocall`)

    ```bash
    curl -sS 'https://SEU_HOST.intelbrasvoice.com.br/api.php' \
      -H 'Content-Type: application/json' \
      -d '{
        "acao": "clicktocall",
        "login": "SEU_LOGIN_CONTA_HTTP",
        "token": "SEU_TOKEN_CONTA_HTTP",
        "origem": "0560",
        "destino": "07183141335"
      }'
    ```

    - **`login` / `token`:** credenciais da **conta API** WideVoice (painel/reseller).
    - **`origem`:** número do **ramal** na central (**não** é o mesmo que user/senha SIP do softphone, embora o ramal coincida).
    - **`destino`:** string **só dígitos**, formato exigido pela rota/trunk da central (vide secção “Plano de discagem”).
    - Variável **`INTELBRAS_WIDEVOICE_BASE_URL`:** URL base **sem** `/api.php` (o path vem em `INTELBRAS_WIDEVOICE_API_PATH`, default `/api.php`).

    ### Sucesso interpretado pelo código (`isTupleSuccess`)

    - Tupla/array parseado onde `Status` (case-insensitive em uso) contenha **`CHAMADA OK`**, **`OK`**, **`SUCESSO`**, etc.
    - Falhas genéricas se contiver `ERRO`, `FALHA`, `NEGAD`, `INVÁLIDO`…

    Respostas problemáticas (HTML gateway, corpo vazio, literal JSON `null`) são tratadas com parse defensivo e metadados de transporte (`_transport`) para diagnóstico.

    ---

    ## 4. Plano de discagem Brasil (`formatBrazilDestinationForWideVoice`)

    Ficheiro: `src/utils/widevoiceDialPlan.util.js`.

    Regras (resumo):

    1. Extrai apenas dígitos; remove país **`55`** se presente em E.164 longo.
    2. Normaliza zeros à esquerda conforme comprimento (inclui alinhamento a exemplos tipo doc **`04821060006`**).
    3. Exige comprimento nacional **10 ou 11** dígitos após saneamento (**DDD + assinante**).
    4. Opcional **`INTELBRAS_CLICKTOCALL_DROP_MOBILE_NINE`:** se assinante tem **9** dígitos e começa por **`9`**, remove esse 9 (**móvel “sem 9”** em troncos legados).
    5. **`INTELBRAS_DIAL_LOCAL_DDD`** (default `11`): se DDD = local, formato `DDD+subscriber` sem prefixo nacional extra.
    6. **`INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL`:**  
      - `true` → para DDD ≠ local prefixa **`011`**.  
      - `false` → só **`DDD`** + **`subscriber`**.
    7. **`INTELBRAS_CLICKTOCALL_PREPEND_ZERO`:** se verdadeiro **e** tronco 011 estiver **desligado** **e** DDD ≠ local, prefixa **`0`** ao nacional (ex. `0719…`).
    8. **`INTELBRAS_CLICKTOCALL_PREPEND_ROUTE`:** só dígitos (ex. **`015`**). Com DDD≠local e tronco **011** off, o `destino` passa a **`ROTA` + `DDD` + `assinante`** (ex. `01571983141335`). **Prevalece sobre** `PREPEND_ZERO` nesse caso — indicação típica do suporte/trunk.

    Implementação integral — **pode estar aquém do ficheiro actual**; fonte de verdade: `src/utils/widevoiceDialPlan.util.js`.

    ```javascript
    'use strict';

    const AppError = require('./AppError');

    /**
    * Discagem BR para WideVoice (`destino` em `clicktocall`).
    *
    * - **DDD “local”** (`INTELBRAS_DIAL_LOCAL_DDD`, default **11**) → só `DDD+assinante`, sem `011`.
    * - **Outros DDD** → por defeito **`011`+DDD+assinante**. Com **`INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL=false`**
    *   fica só `DDD+número` (**exemplo doc Intelbras**: também pode exigir **`0`+DDD+número** →
    *   **`INTELBRAS_CLICKTOCALL_PREPEND_ZERO=true`** só para chamadas onde DDD ≠ local).
    * - Algumas centrais antigas pedem móvel **sem** o 9 inicial após o DDD (`71`+8 dígitos): **`INTELBRAS_CLICKTOCALL_DROP_MOBILE_NINE=true`**.
    */

    function onlyDigits(input) {
      return `${input ?? ''}`.replace(/\D/g, '');
    }

    function use011TrunkForNonLocalDdd() {
      const v = `${process.env.INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL ?? 'true'}`.trim().toLowerCase();
      /** default true — mantém comportamento anterior (DDD ≠ local ⇒ prefixo 011). */
      return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
    }

    function clickToCallPrependLeadingZeroForNonLocal() {
      const v = `${process.env.INTELBRAS_CLICKTOCALL_PREPEND_ZERO ?? 'false'}`.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes' || v === 'on';
    }

    function clickToCallDropMobileNineAfterDdd() {
      const v = `${process.env.INTELBRAS_CLICKTOCALL_DROP_MOBILE_NINE ?? 'false'}`.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes' || v === 'on';
    }

    function formatBrazilDestinationForWideVoice(raw, opts = {}) {
      const localDdd = `${opts.localDdd ?? process.env.INTELBRAS_DIAL_LOCAL_DDD ?? '11'}`.trim();
      let d = onlyDigits(raw);
      if (!d) {
        throw new AppError('Número de destino vazio.', 400, { campo: 'destino' }, true);
      }

      if (d.startsWith('55') && d.length > 11) {
        d = d.slice(2);
      }

      while (d.startsWith('0') && d.length > 11) {
        d = d.slice(1);
      }
      if (d.startsWith('0') && d.length === 11) {
        d = d.slice(1);
      }

      if (d.length < 10 || d.length > 11) {
        throw new AppError(
          'Número inválido: após país/DDD esperam-se 10 ou 11 dígitos brasileiros.',
          400,
          { campo: 'destino', digitos: d.length },
          true
        );
      }

      const ddd = d.slice(0, 2);
      let subscriber = d.slice(2);

      if (subscriber.length < 8) {
        throw new AppError('Número local incompleto após DDD.', 400, { campo: 'destino' }, true);
      }

      if (
        clickToCallDropMobileNineAfterDdd() &&
        subscriber.length === 9 &&
        subscriber.startsWith('9')
      ) {
        subscriber = subscriber.slice(1);
      }

      if (subscriber.length < 8) {
        throw new AppError('Número local incompleto após DDD (após regra do 9).', 400, { campo: 'destino' }, true);
      }

      if (!/^\d{2}$/.test(ddd)) {
        throw new AppError('DDD inválido.', 400, { campo: 'destino' }, true);
      }

      let formatted;
      if (ddd === localDdd) {
        formatted = `${ddd}${subscriber}`;
      } else if (!use011TrunkForNonLocalDdd()) {
        formatted = `${ddd}${subscriber}`;
      } else {
        formatted = `011${ddd}${subscriber}`;
      }

      if (
        clickToCallPrependLeadingZeroForNonLocal() &&
        !use011TrunkForNonLocalDdd() &&
        ddd !== localDdd
      ) {
        if (!formatted.startsWith('0')) {
          formatted = `0${formatted}`;
        }
      }

      return formatted;
    }

    module.exports = {
      onlyDigits,
      formatBrazilDestinationForWideVoice,
      use011TrunkForNonLocalDdd,
      clickToCallPrependLeadingZeroForNonLocal,
      clickToCallDropMobileNineAfterDdd,
    };
    ```

    ---

    ## 5. Variáveis de ambiente (checagem rápida)

    Ver `.env.example` secção Intelbras para defaults comentados. Principais:

    | Variável | Efeito |
    |----------|--------|
    | `INTELBRAS_WIDEVOICE_BASE_URL` | Host HTTPS **sem** `/api.php`. |
    | `INTELBRAS_WIDEVOICE_LOGIN` | Login HTTP conta WideVoice (`INTELBRAS_REST_LOGIN` compat). |
    | `INTELBRAS_WIDEVOICE_TOKEN` | Token HTTP conta (`INTELBRAS_REST_TOKEN` compat). |
    | `INTELBRAS_WIDEVOICE_API_PATH` | Default `/api.php`. |
    | `INTELBRAS_REST_TIMEOUT_MS` | Timeout Axios. |
    | `INTELBRAS_DIAL_LOCAL_DDD` | DDD tratado como “local” para não prefixar 011/zero extra. |
    | `INTELBRAS_DIAL_USE_011_FOR_NON_LOCAL` | `false` ⇒ sem prefixo nacional 011 entre DDDs. |
    | `INTELBRAS_CLICKTOCALL_PREPEND_ZERO` | `true` ⇒ com 011 off e DDD ≠ local → prefixo **`0`** (alternativa à rota `015`). |
    | `INTELBRAS_CLICKTOCALL_PREPEND_ROUTE` | Ex.: `015` ⇒ `015`+DDD+assinante quando 011 off e DDD≠local. |
    | `INTELBRAS_CLICKTOCALL_DROP_MOBILE_NINE` | Remove dígito 9 inicial em móveis 9 dígitos após DDD. |
    | `INTELBRAS_WIDEVOICE_PUBLIC_PROBE` | `GET widevoice-check` (default permite em homolog; PRD pode desligar). |
    | `INTELBRAS_TELECOM_LAB_ENABLED` | Liga rotas `/lab/*`. |
    | `INTELBRAS_TELECOM_LAB_SECRET` | Opcional header `x-telecom-lab-secret`. |
    | `INTELBRAS_LAB_ORIGEM_RAMAL` | Ramal default laboratório. |
    | `INTELBRAS_LAB_DESTINO` | Destino default E.164/dígitos. |
    | `INTELBRAS_LAB_DESTINO_VARIANTS` | CSV para botões de variante no HTML. |

    ---

    ## 6. Endpoints HTTP deste backend

    Base prefix: **`/api/v1/telecom`**.

    | Método | Rota | Proteção | Descrição |
    |--------|------|----------|-----------|
    | GET | `/widevoice-check` | Probe público (toggle env) | `statusramais` via `probeWideVoiceFromEnv` — valida rede/credencial sem lab secret. |
    | GET | `/lab/ping` | `INTELBRAS_TELECOM_LAB_ENABLED` | Sanity check lab. |
    | GET | `/lab/defaults` | idem | `origem`, `destino`, `destino_variantes`. |
    | POST | `/lab/run-demo` | idem | Resolve defaults + `clickToCallDetailed` + logs `[telecom:lab]`. |
    | POST | `/lab/clicktocall` | idem | Corpo `{ origem, destino, format_destino? }`. |
    | POST | `/lab/liberarramal` | idem | Corpo `{ ramal }` (nome de campo configurável por env para WideVoice). |
    | POST | `/lab/statusramais` | idem | Proxy `statusramais`. |
    | POST | `/lab/statusoperacoes` | idem | Janelas de datas + lookback opcional via env. |

    ---

    ## 7. Fluxo `clickToCall` no serviço (resumo)

    1. Valida strings `origem` e `destino`.
    2. Se `formatDestino !== false`, aplica `formatBrazilDestinationForWideVoice(destino)`.
    3. `wideVoiceAction('clicktocall', { origem, destino })`.
    4. Se HTTP OK e tuple sucesso extrai **`ID`** (vários aliases de campo).

    Versão **`clickToCallDetailed`:** devolve `destino_enviado`, `http_status`, `widevoice_raw`, flags para UI/lab — **mesma lógica de formatação**.

    ---

    ## 8. Hard cut sessão (`hangupSessionMedia`)

    Ordem implementada:

    1. Obter **`intelbras_ramal`** da especialista (sessão ou hint).
    2. **`liberarramal`** (obrigatório se há ramal).
    3. Opcionalmente **`desligar`** por `uniqueid` se `INTELBRAS_WIDEVOICE_TRY_DESLIGAR_BY_UID=true`.

    Útil quando saldo cliente zera e preciso libertar recurso físico SIP.

    ---

    ## 9. Perguntas úteis à Intelbras / reseller

    Para desbloqueio quando **`CHAMADA OK`** não se traduz em toque útil:

    1. **Formato exacto campo `destino`** para esta conta/troncos (com/sem `0`, `011`, 9 móvel após DDD).
    2. **Fluxo click-to-call:** o ramal `origem` **deve tocar e ser atendido** antes da perna até ao PSTN/celular?
    3. Ramais **0560/0561/0562** com perfil **telefonista** e **saída** activa — há dependência por **IP egresso do servidor HTTPS** versus **REGISTER SIP do ramal**?
    4. Confirmar número **entrante DDI** da conta para teste de **chamada oposta** (cliente marca para a empresa e valida entrada na mesma infra).

    ---

    ## 10. Segurança

    - **Rotacionar** qualquer token/captura já partilhada em chats com imagens.
    - Probe público **`widevoice-check`** expõe saída **`statusramais`** se credenciais estiverem válidas — desligar com `INTELBRAS_WIDEVOICE_PUBLIC_PROBE=false` em produções sensíveis.
    - Laboratório `/lab/*` deve estar **OFF** ou protegido com segredo forte em PRD (`INTELBRAS_TELECOM_LAB_*`).

    ---

    ## 11. Como repro um bug “só com logs”

    1. Confirmar valores finais `[WideVoice:clicktocall] pedido … { origem, destino }`.
    2. Comparar com exemplo manual oficial (`04821060006` etc.).
    3. Imediatamente após chamada falha perceptiva rodar **`statusramais`** (botão página ou `/lab/statusramais`) e ver estado **IDLE / ocupado**.
    4. Testar mesmo corpo **`POST`** com **`curl`** a partir da **mesma rede** onde corre o Node para isolar Axios vs rede.

    ---

    *Documento interno projeto `fadasdobem--api` — manter sincronizado com alterações em `intelbras.service.js` e `widevoiceDialPlan.util.js`.*

# Feature `config/`

**Propósito:** expor dados **públicos** de configuração para o front (sem segredos de terceiros), ex.: IDs de Agora públicos, e-mails ou identificadores de homologação acordados com o produto.

**Pasta:** `src/features/config/`

| Ficheiro | Papel |
|----------|--------|
| `config.routes.js` | `GET /public` |
| `config.controller.js` | Monta payload seguro |

**Variáveis:** leituras pontuais de `process.env` e consultas só a campos públicos na BD (`config.controller.js` — ver implementação atual).

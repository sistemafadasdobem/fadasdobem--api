# Documentação dos *middlewares* (`src/middlewares/`)

Encadeamento Express transversal: autenticação JWT, papel **TARÓLOGA** onde aplicável, limites de taxa de Auth, assinatura Mercado Pago, 404 e tratamento global de erros.

| Documento | Conteúdo |
|-----------|----------|
| [Registo_Middlewares.md](./Registo_Middlewares.md) | Ficheiro a ficheiro: responsabilidade, ordem típica, env |

Montagem: rotas em `src/routes/index.js` e `src/features/*/*.routes.js`; `app.js` aplica JSON, *helmet*, *cors*, depois `routes` em `/api`.

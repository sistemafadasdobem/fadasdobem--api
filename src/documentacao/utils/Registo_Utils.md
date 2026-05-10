# Registo — `src/utils/*.js`

| Ficheiro | Responsabilidade |
|----------|------------------|
| `AppError.js` | Classe de erro operacional (`message`, `statusCode`, detalhes, `isOperational`) consumida pelo `errorHandler.middleware` e pelos serviços. |
| `catchAsync.util.js` | `catchAsyncRoute(fn)` — *wrapper* para handlers Express async; erros passam para `next(err)`. |
| `response.util.js` | `responderSucesso`, `responderErro` e variantes alinhadas ao contrato JSON da API (códigos, payload). |

**Uso:** *controllers* e *middlewares* importam estes módulos; evitar duplicar formato de resposta fora deste utilitário.

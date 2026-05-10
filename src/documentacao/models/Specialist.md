# Tabela `specialists`

**Propósito:** vitrine técnica e operativa das tarólogas: reputação em cache, dados de PIX para repasses, estado em tempo quase-real, trava anti-corrida no checkout, **perfil público rico (Fase 3)** e **fuso IANA** que contextualiza a agenda semanal em `specialist_schedules`.

---

## Campos

| Campo | Tipo | Nulo | Observação |
|-------|------|------|------------|
| `id` | UUID | Não | PK. |
| `user_id` | UUID | Não | FK única ao `users` com papel TARÓLOGA. |
| `display_name`, `bio`, `avatar_url`, `cover_image_url` | String/Text | Sim | UX vitrine. |
| `greeting_audio_url` | VARCHAR(1024) | Sim | URL (CDN / assinada) do **áudio de boas-vindas** na vitrine. |
| `presentation_video_url` | VARCHAR(1024) | Sim | **Vídeo de apresentação** (vitrine). |
| `experience_years` | SMALLINT | Sim | Anos de experiência declarados (campo anterior `years_experience` foi renomeado na migração Fase 3). |
| `timezone` | VARCHAR(64) | Não | Fuso **IANA**; predefinição `America/Sao_Paulo`. Horários em `specialist_schedules` são *wall-clock* neste fuso. |
| `chave_pix`, `chave_pix_type`, `titular_pix_nome` | String | Sim | Necessários para payouts. |
| `status` | Enum | Não | `ONLINE` \| `EM_ATENDIMENTO` \| `AUSENTE` \| `OFFLINE`. Transições gravadas em `specialist_status_logs` (hooks em `src/models/index.js`). |
| `reserved_by_client_id`, `reserved_until` | UUID/Date | Sim | Trava corrida até ~8 min antes do pagamento. |
| `rating_average_cached`, `reviews_count_cached`, `sessions_completed_cached` | Numéricos | Métricas | Atualização assíncrona. |
| `vitrine_ordem`, `accepts_queue_any` | Int/Bool | — | Ordenação & filas. |
| `commission_percent_default` | DECIMAL | Sim | Base comissão até contratos extras. |
| `agora_uid`, `intelbras_ramal`, `chatwoot_inbox_id` | String | Sim | Integrações tecnológicas. |
| `is_blocked`, `blocked_reason` | Bool/Text | — | Travas administrativas. |

---

## Relacionamentos Fase 3

| Destino | Card. | Alias Sequelize |
|---------|-------|-----------------|
| `specialist_schedules` | 1 : N | `agenda_horarios` |
| `specialist_status_logs` | 1 : N | `historico_status` |

---

## Integridade temporal

Os valores `TIME` da agenda pertencem ao **relógio civil** da profissional no fuso `specialists.timezone`. Aplicações devem usar biblioteca com TZ correto para projectar disponibilidade e navegar **DST**.

---

## Hooks de `status`

- **`afterCreate` / `afterUpdate`** persistem **`specialist_status_logs`** quando o estado operacional muda de facto.
- `Specialist.update(..., { where })` só dispara estes hooks por linha com **`individualHooks: true`**; caso contrário, preferir carregar instâncias e **`save()`** ao mudar status.

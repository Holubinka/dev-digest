# SPEC-07 — Agent Performance

**Spec ID:** SPEC-07
**Modules:** server, client
**Status:** Implemented 2026-08-29
**Design:** [`assets/SPEC-07-agent-performance-dashboard.jpg`](assets/SPEC-07-agent-performance-dashboard.jpg)
**Design walk:** [`assets/SPEC-07-agent-performance-DESIGN-WALK.md`](assets/SPEC-07-agent-performance-DESIGN-WALK.md)

## Summary

Глобальний екран, який відповідає на одне питання: **які агенти виправдовують свої витрати**.
Він агрегує вже збережені `agent_runs`, `reviews` і `findings` по всіх агентах воркспейсу за
обраний період і не робить жодного виклику до моделі.

## Goals

- **G1** — показати runs, cost, duration і accept rate по всіх агентах за один період, поруч.
- **G2** — жодне число на екрані не вигадане: те, чого система не знає, показується як «—», а не як нуль.
- **G3** — екран нічого не витрачає: він читає, він не запускає.

## Non-goals

Рядок **Memory** у сайдбарі, Weekly Digest, звірка з реальними billing data провайдера,
drill-down у список окремих запусків, експорт CSV.

## Context — what already exists

| Факт | Де |
|---|---|
| Контракт `AgentPerf` / `AgentPerfRow` для `GET /agents/performance` | `server/src/vendor/shared/contracts/productionize.ts:135` |
| Ключ активного рядка сайдбара `agent-performance` для шляху `/agent-performance` | `client/src/components/app-shell/helpers.ts:42` |
| Неспожитий namespace перекладів `agentPerformance` | `client/messages/en/agentPerformance.json` |
| Рядок сайдбара, маршрут, сервіс і сторінка | **не існують** |
| Вкладка Stats у агента (`GET /agents/:id/stats`) | **не існує** — `AgentEditor/constants.ts:11`, відкладена `SPEC-05 § N3` |
| Кожен `agent_runs.cost_usd` — оцінка з price book (`estimateCost` / `PriceBook`) | `server/src/adapters/llm/pricing.ts`, `server/src/platform/price-book.ts` |
| Звірених billing data у системі немає ніде | — |

Останні два рядки — причина, чому AC-33/AC-34 сформульовані як розкриття, а не як вибір
джерела: **вибирати нема з чого**, і екран мусить це сказати вголос, а не мовчати.

## Decisions

- **D1 — вкладка Stats будується в цьому ж PR.** Критерій «збігається зі Stats того самого
  агента» неперевірний, поки вкладки немає. Обидва маршрути живить **одна** функція агрегації,
  тож збіг — властивість конструкції, а не збіг обставин.
- **D2 — Avg accept rate є pooled, а не середнім із середніх.** Мокап показує 61% при агентах
  78/64/41, тобто незважене середнє трьох ставок. Ми віддаємо `accepted / (accepted + dismissed)`
  по всьому воркспейсу, бо критерій вимагає **показати знаменник**, а в середнього із середніх
  знаменника не існує. Розбіжність записана в design walk.
- **D3 — зараховуються лише термінальні запуски** (`done`, `failed`, `cancelled`). `queued` і
  `running` ще не мають ні вартості, ні тривалості, ні findings; зарахувати їх означає показати
  запуск, чиї числа ще не існують.
- **D4 — failed зараховується.** Невдалий запуск міг спалити токени. Викинути його з Total cost
  означає показати суму, меншу за витрачене.
- **D5 — finding належить періоду свого ЗАПУСКУ**, а не моменту accept/dismiss. Інакше accept
  rate за період не зводиться з runs за той самий період.
- **D6 — таблиця перелічує всіх агентів воркспейсу**, включно з тими, у кого нуль запусків у
  періоді. Агент без запусків — це відповідь, а не порожнеча.

## Acceptance criteria

### Navigation

- **AC-1** — THE SYSTEM SHALL показувати рядок «Agent Performance» у секції GLOBAL сайдбара,
  між «Multi-Agent Review» і «CI Runs».
- **AC-2** — WHEN відкрито `/agent-performance`, THE SYSTEM SHALL підсвічувати цей рядок активним.
- **AC-3** — WHEN натиснуто «View» у рядку агента, THE SYSTEM SHALL перейти на
  `/agents/{id}?tab=stats`.

### Period

- **AC-4** — THE SYSTEM SHALL підтримувати три періоди: **1 day**, **30 days**, **custom range**.
- **AC-5** — WHERE період не вказано в URL, THE SYSTEM SHALL використати 30 days.
- **AC-6** — WHEN користувач змінює період, THE SYSTEM SHALL записати вибір в URL, щоб посилання
  на екран несло період.
- **AC-7** — THE SYSTEM SHALL трактувати період як напівінтервал `[from, to)`:
  `ran_at >= from AND ran_at < to`.
- **AC-8** — IF custom range має `from >= to`, невалідну дату або відсутню межу, THEN THE SYSTEM
  SHALL відповісти `422` і не показати жодного числа.
- **AC-9** — THE SYSTEM SHALL повернути фактичні межі періоду у відповіді, щоб підпис під
  числами називав саме той інтервал, який порахований.

### Counted runs

- **AC-10** — THE SYSTEM SHALL зараховувати рівно ті запуски воркспейсу, чий `ran_at` лежить у
  періоді і чий `status` термінальний (`done`, `failed`, `cancelled`).
- **AC-11** — THE SYSTEM SHALL не зараховувати запуски зі `status` `queued` або `running`.
- **AC-12** — THE SYSTEM SHALL атрибутувати finding до періоду за `ran_at` його запуску, а не за
  часом accept або dismiss.

### Summary tiles

- **AC-13** — Total runs SHALL дорівнювати кількості зарахованих запусків.
- **AC-14** — Total cost SHALL дорівнювати сумі `cost_usd` по зарахованих запусках, у яких
  `cost_usd` не `null`.
- **AC-15** — IF хоч один зарахований запуск має `cost_usd = null`, THEN THE SYSTEM SHALL показати
  кількість таких запусків поруч із Total cost, бо сума є нижньою межею, а не сумою.
- **AC-16** — Avg accept rate SHALL дорівнювати `accepted / (accepted + dismissed)` по findings
  зарахованих запусків, і `null`, коли знаменник нульовий.
- **AC-17** — THE SYSTEM SHALL показувати знаменник `accepted + dismissed` поруч із Avg accept rate.
- **AC-18** — Most-active agent SHALL визначатися за кількістю зарахованих запусків у періоді;
  при рівності — пізніший `last_run_at`, далі ім'я за зростанням.
- **AC-19** — IF жоден зарахований запуск не належить наявному агенту, THEN Most-active agent
  SHALL бути порожнім і картка SHALL сказати це словами.
- **AC-20** — THE SYSTEM SHALL показувати кількість зарахованих запусків періоду на картці
  Most-active agent.

### Table

- **AC-21** — Таблиця SHALL мати колонки Agent, Runs, Avg cost, Avg duration, Accept rate,
  Last run і дію View.
- **AC-22** — THE SYSTEM SHALL показувати рядок для кожного агента воркспейсу, включно з тими,
  у кого нуль зарахованих запусків у періоді.
- **AC-23** — IF агент має нуль зарахованих запусків, THEN THE SYSTEM SHALL показати `0` у Runs
  і «—» у Avg cost, Avg duration, Accept rate і Last run — ніколи `$0.00` і ніколи `0%`.
- **AC-24** — THE SYSTEM SHALL показувати знаменник accept rate у кожному рядку.
- **AC-25** — THE SYSTEM SHALL показувати кількість зарахованих запусків рядка у колонці Runs,
  підписаній обраним періодом.
- **AC-26** — Avg cost SHALL дорівнювати сумі вартості рядка, поділеній на кількість його
  зарахованих запусків, що мають `cost_usd`, і `null`, якщо таких немає.
- **AC-27** — Avg duration SHALL дорівнювати середньому `duration_ms` по зарахованих запусках
  рядка, де `duration_ms` не `null`.

### Sorting and small samples

- **AC-28** — THE SYSTEM SHALL дозволяти сортування за Runs, Avg cost, Avg duration, Accept rate
  і Last run.
- **AC-29** — WHERE агент має менше ніж `min_decisions_for_rank` рішень, THE SYSTEM SHALL
  позначити його accept rate як малу вибірку **і** поставити його нижче ранжованих агентів при
  сортуванні за accept rate.
- **AC-30** — THE SYSTEM SHALL повертати `min_decisions_for_rank` у відповіді, щоб клієнт не
  тримав власної копії порога.
- **AC-31** — WHEN користувач сортує таблицю, THE SYSTEM SHALL не робити нового запиту до API.

### Cost breakdown and provenance

- **AC-32** — Сума сегментів «by agent» SHALL дорівнювати Total cost.
- **AC-33** — Сума сегментів «by model» SHALL дорівнювати Total cost.
- **AC-34** — IF зараховані запуски належать видаленому агенту, THEN THE SYSTEM SHALL показати їх
  окремим сегментом і окремим числом у summary, а не розчинити в інших агентах.
- **AC-35** — IF `model` запуску є `null`, THEN його вартість SHALL потрапити в сегмент з явною
  назвою «Unknown model».
- **AC-36** — THE SYSTEM SHALL позначити кожну cost-метрику як **оцінку DevDigest** з price book.
- **AC-37** — THE SYSTEM SHALL прямо сказати, що звірених billing data провайдера немає, і SHALL
  не показувати жодного числа як звірене, доки такого джерела в системі не існує.

### States

- **AC-38** — WHILE відповідь вантажиться, THE SYSTEM SHALL показувати skeleton і жодного нуля.
- **AC-39** — IF запит впав, THEN THE SYSTEM SHALL показати ErrorState з повтором і жодного нуля.
- **AC-40** — IF у воркспейсі немає жодного агента, THEN THE SYSTEM SHALL показати empty state,
  що веде на `/agents`.
- **AC-41** — IF агенти є, але в періоді немає жодного зарахованого запуску, THEN THE SYSTEM SHALL
  показати інший empty state, який називає період і пропонує його розширити.
- **AC-42** — IF у періоді є запуски, але цей конкретний агент не має жодного, THEN його рядок
  SHALL показати стан «нуль запусків» (AC-23), а екран SHALL лишитися звичайним, не порожнім.

### No model calls

- **AC-43** — THE SYSTEM SHALL читати лише збережені `agent_runs`, `reviews` і `findings`; жоден
  маршрут цього екрана SHALL не викликати LLM.
- **AC-44** — WHEN користувач перезавантажує сторінку, сортує таблицю або розгортає рядок,
  THE SYSTEM SHALL не запускати review і не робити model call.

### Consistency with the agent's Stats tab

- **AC-45** — THE SYSTEM SHALL віддавати вкладку Stats агента з **тієї самої** функції агрегації,
  що живить дашборд.
- **AC-46** — WHEN відкрито Stats агента і дашборд за той самий період, runs, cost, duration і
  accept rate цього агента SHALL збігатися.
- **AC-47** — Вкладка Stats SHALL приймати той самий набір періодів, що й дашборд.

## Corner cases the design did not show

| Випадок | Що робить система |
|---|---|
| Агент видалено, його запуски лишились (`agent_id` = NULL) | окремий сегмент вартості + число в summary; у таблиці рядка немає — імені вже не існує (AC-34) |
| `cost_usd` = NULL у частині запусків | Total cost — нижня межа; кількість таких запусків показана (AC-15) |
| `duration_ms` = NULL | запуск не входить у знаменник середньої тривалості (AC-27) |
| Жодного judged finding | accept rate = «—», не 0% (AC-23) |
| Один judged finding | 100%, позначено як мала вибірка (AC-29) |
| Два агенти з однаковою кількістю запусків | тайбрейк за `last_run_at`, далі за іменем (AC-18) |
| Custom range у майбутньому | валідний, порожній результат — це стан AC-41, не помилка |

## Sources

- Мокап: `specs/assets/SPEC-07-agent-performance-dashboard.jpg`
- Критерії приймання від замовника, 2026-08-29 (переписані вище в EARS)
- `server/src/vendor/shared/contracts/productionize.ts:135` — наявний контракт
- `server/src/db/schema/runs.ts:12` — `agent_runs`, включно з коментарем про `cost_usd`
- `server/src/modules/skills/service.ts:75-88` — наявне правило accept rate, яке це наслідує

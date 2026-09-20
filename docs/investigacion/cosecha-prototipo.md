VIGENTE

# Cosecha del prototipo IAGENT-COMPANY (repositorio `bitclick-solution/iagent-platform`)

- Rebanada: [Notion](https://app.notion.com/p/3e05306618988123abbac5a8cb860eec) · Ciclo 0 · Tipo Investigación · Investigador · 2026-09-20
- Fuente: `bitclick-solution/iagent-platform`, commit `fbb3f37` (2026-09-19 21:24), 15 rodajas, 20 ADR, 232 archivos Python, contratos ejecutables y suite de conformidad. Los documentos de diseño (`docs/plataforma.md`, `roadmap-ingenieria.md`) viven fuera del repositorio, en el PC de Jesús, y no se han podido leer: las referencias «§11, §12, §14 a §18» de este informe son las del prototipo.
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), sección «Qué hacer con lo que ya existe» (el prototipo se cosecha; su código no migra) y ADR-002.

## Pregunta

Qué se lleva AI Workforce del prototipo (ideas, contratos, lecciones), qué se deja atrás, y qué decisiones del plan cambia lo aprendido.

## Respuesta corta

El código no migra: es Python sobre n8n, con un plano de ejecución fuera del repositorio y un bus Redis, y el plan fija TypeScript, Temporal y una sola base con RLS. Migran cinco activos de diseño que ya están probados en producción con los agentes de la propia Bitclick, y nueve lecciones que evitan errores concretos. Tres de esas lecciones cambian decisiones del plan y van como propuestas de ADR para el miércoles 23: el contrato de delegación entre agentes necesita política de respaldo y caducidad; el ciclo de vida del agente necesita un estado de drenaje con tiempo máximo y una reanudación gobernada; el borrado GDPR es supresión con lista anonimizada, no amnesia.

## Qué es el prototipo, en cinco líneas

1. Un plano de control («Mission Control») que registra, gobierna, vigila y audita agentes hechos en cualquier cosa; el plano de ejecución (n8n, MCP, canales) queda fuera (ADR-001 del prototipo).
2. Un contrato de agente de ocho casillas que se cumple «por los bordes, no por las entrañas»: fila en el registro, claves `enabled` y `autonomy_level`, vista de eventos, eventos válidos en el bus, trazas en Langfuse con coste, pausa `active → draining → paused`, borrado GDPR, huella del pack de identidad (ADR-006).
3. Una suite de conformidad que es la especificación de esas casillas: «la prosa dice por qué; el contrato dice qué; el test dice si se cumple» (README, `conformance/`).
4. Una cascada de identidad de marca compilada: organización → departamento → canal → puesto, con lista de claves permitidas por nivel y huella SHA-256 (ADR-009, 017, 018 y 020; `brand/`, `libs/iagent_packs`).
5. Cinco agentes de Bitclick en producción (Roubén, Vector, Biónica, Romón, Ailicia) más tres de plataforma (gabinete, QA, recepcionista), un panel de cliente y un índice de conocimiento por tenant (ADR-019).

## Evidencias, con fuente

| Activo o lección | Dónde está | Qué dice, en corto |
| --- | --- | --- |
| Contrato en casillas verificado por conformidad | `README.md`, `conformance/README.md`, `conformance/test_c1..c8` | Ocho casillas; la suite audita la mecánica común y las evals del blueprint la conducta de negocio. El orden real de cableado es 1-2, 6, 4-3, 5, 7-8: «lo primero que el cliente nota es pausar y que pare de verdad» (`docs/conectar-un-worker.md`). |
| Bus con envolvente y nombres en pasado | `contracts/EVENTS.md`, `contracts/events.schema.json` | `event_id`, `worker`, `tenant`, `department`, `kind`, `ts`, `severity`, `summary` en idioma de negocio, `payload`. Las peticiones agente a agente (`request.*`) llevan obligatoriamente `ttl_seconds` y `fallback_policy` (`continue_without`, `park`, `escalate_human`); los hechos no. Regla 7: un campo obligatorio nuevo es versión nueva. El payload no lleva datos personales por construcción. |
| Pausa como primitiva | ADR-008, `test_c6_draining.py`, `BACKLOG.md` B1, B2, B3 | `active → draining → paused` con colas conservadas. Lo que faltó: persistencia real del bus (B1), tiempo máximo de drenaje (B2, 15 minutos por defecto) y reanudación sin avalancha ni mensajes obsoletos (B3: límite de ritmo y política `stale`). |
| Una sola pluma | ADR-013 | El Control API es el único escritor del estado de control; en la base de negocio escribe con un rol acotado (`mc_writer`). «Las dos bases, y no confundirlas» es el error caro de la rodaja 3. |
| Un vigilante propone, nunca aplica | `README.md` (D11), ADR-014, `mc_proposal` en `contracts/registry.sql`, B7 | Toda corrección entra como propuesta con motivo y carga, y la firma una persona; `apply_audit_id` enlaza la propuesta con el apunte de auditoría. Lo que faltó: una propuesta sin atender no escala (B7: más de 72 horas debe avisar al operador). |
| Sombra operativa, no declarativa | `README.md`, `BACKLOG.md` B38, `blueprints/qa/manifest.yaml` | «shadow es el staging cognitivo». En la rodaja 6 los gates honraban `enabled` pero no `autonomy_level`: una degradación firmada era declarativa. Se arregló haciendo que sombra cierre el gate de verdad, agente a agente y con su semántica declarada («qué significa sombra para un chat»). |
| Dos palancas con el mismo nombre | B16, B28 | `enabled` era a la vez interruptor de emergencia y «toma trabajo nuevo»; las dos fuentes divergían. Una palanca por significado y una sola fuente de verdad. |
| Cascada de identidad con regla de sutileza | ADR-009, 017, 018, 020; `brand/README.md`, `brand/org/visual.yaml`, `libs/iagent_packs/iagent_packs/errores.py` | Voz y tokens visuales heredan org → departamento → canal → puesto; un nivel solo escribe las claves que el superior le permite (`overridable`), y violarlo es error de compilación, no aviso. El canal es parámetro de compilación, no un nivel del registro (ADR-018). El pack compilado tiene huella; editar la marca desde el panel es proponer un PR, nunca escribir (ADR-020). La voz tiene dos registros: interno y de cara al cliente (`brand/org/voice.md`). |
| Blueprint de departamento como paquete | ADR-003, `blueprints/*/manifest.yaml` | Identidad, nacimiento (por el panel, con lo que deriva la API), ciclo de vida con el significado de cada nivel de autonomía para ese puesto, programación dentro del agente, modelo, presupuesto y las casillas con su prueba. Evals con casos dorados en `evals/fixtures`. |
| GDPR: supresión, no amnesia | ADR-016, `test_c7_gdpr_erasure.py`, B6, B12, B25 | El evento `gdpr.erasure_requested` con alcance lo consumen todos los departamentos y el índice; la revocación se anonimiza y se conserva como lista de supresión. Lo que faltó: fragmentos del índice etiquetados con `subject_refs` para poder borrar (B6), y el consentimiento registrado con evidencia antes del primer contacto (B25, marcado como crítico). |
| Conocimiento: fuente suya, índice nuestro | ADR-010 y ADR-019 del prototipo | Idéntico al ADR-009 del plan: el índice es derivado y desechable; una fila por fuente con tipo, modo, sincronización y región. |
| Coste con dueño | ADR-002, B30, `blueprints/gabinete/src/adapters/costes.py` | El gasto del mes por agente se atribuye por el prefijo `<worker>:` del nombre de la traza y hereda agente → departamento → tenant. Sin atribución en la traza, el presupuesto no se puede vigilar. |
| Sondas que contaminan | B41 | Los eventos sintéticos de la conformidad entraron en los KPI del cliente («15 leads» con las sondas dentro). Toda prueba contra sistemas reales lleva marca de sintético. |
| El panel | B37, rodaja 10 y 11 | «El panel es horrible» (palabras del dueño): funcionaba, pero sin diseño. El panel del cliente muestra tres números con tendencia y declara qué no ve nunca el cliente: costes internos, infraestructura, vigilantes. La recepcionista opera el plano de control por chat (pausar, reanudar, dar de alta) y necesitó frases exactas para los estados intermedios (B42). |
| Método | `AGENTS.md`, `README.md` | Jerarquía de la verdad: contratos, ADR, especificación, criterio propio declarado como «decisión propia». SQL idempotente. Auditoría intocable con disparador. «Skip con motivo, nunca pass vacío». La limpieza se verifica, no se declara. WIP de una rodaja. ADR para toda decisión que duela revertir. |

## Qué se lleva AI Workforce y a qué rebanada va

1. **El contrato de agente externo en casillas, verificado por una suite** → rebanada «Conector por descripción» (fase 2) y piloto A2A (fase 3). Para AI Workforce las casillas son garantías nativas del motor; para agentes y conectores de fuera (n8n de un cliente, un agente A2A) son el contrato de entrada, y la suite de conformidad es la especificación. Reduce el riesgo «Un conector generado por IA es inseguro o incorrecto».
2. **La cascada de identidad** → «Documento de producto» y «Sala v0». Brand voice global y por rama es un imprescindible del producto: se adopta el diseño entero (cuatro niveles, `overridable`, error de compilación, huella del pack en cada versión de puesto, dos registros). La huella entra en `version_puesto` para saber con qué voz actuó el agente.
3. **La envolvente de eventos y la convención de nombres** → `evento_salida` del modelo de datos y la sala. `summary` en idioma de negocio para el feed y las notificaciones; ningún dato personal en payloads; marca de sintético.
4. **La pausa con drenaje y la reanudación gobernada** → ADR-006 y «Prueba técnica del stack». Ver la propuesta 2 de abajo.
5. **Propuestas con motivo, carga, firma y enlace a auditoría, con escalado a las 72 horas** → ADR-006 (propuesta de operación, ya prevista) y «Bandeja humana v1». El Director de IA y los supervisores proponen, nunca aplican.
6. **Sombra operativa** → criterio de hecho de «Prueba técnica del stack»: un agente en prueba no ejecuta ninguna escritura, y una prueba lo demuestra.
7. **Blueprints con casos dorados** → «Documento de producto» (fichas) y `packages/evals`: cada ficha declara qué significa cada nivel de autonomía para ese puesto y trae sus casos dorados.
8. **Atribución de coste en la traza** → «Contador de tareas v0» y `packages/models`: toda traza lleva tenant, puesto, tarea y versión de puesto.
9. **Panel: tres números con tendencia y lo que el cliente no ve nunca** → «Prototipo de interfaz» y «Cuadros de mando».

## Qué no migra, y por qué

- El Control API, el bus-gateway y el panel de cliente (Python y JavaScript sin framework): AI Workforce los reconstruye en TypeScript con Temporal, outbox transaccional y Centrifugo (ADR-002 y ADR-007 del plan). Migrar código duplicaría dos planos de control.
- Los cinco agentes de n8n y su base «de la familia»: siguen operando el negocio de Bitclick tal cual. Entran en AI Workforce cuando la plataforma tenga paridad (ver decisión 4).
- Redis Streams como bus: la delegación y los eventos viven en Temporal y en `evento_salida`.
- La separación en dos bases: AI Workforce tiene una base con RLS forzada; la lección «una sola pluma» se conserva en `@aiw/ledger` y en la API.

## Alternativas consideradas

- Migrar el Control API como servicio aislado en Python: descartado, contradice ADR-002 y crea dos verdades del estado.
- Reescribir los agentes de n8n como puestos de AI Workforce ya en la fase 0: descartado, no hay motor todavía; se hará por paridad y con el contrato de agente externo como puente.

## Recomendación

No migrar código. Incorporar los nueve puntos de arriba como entradas de rebanadas ya planificadas y aprobar el miércoles tres cambios de decisión:

1. **ADR-004, contrato de delegación:** además de encargo, plazo, presupuesto y formato, toda petición entre agentes lleva caducidad y política de respaldo (`seguir sin ello`, `aparcar`, `escalar a persona`); los hechos consumados no caducan ni tienen plan B.
2. **ADR-006, ciclo de vida:** estado transitorio «pausando» con tiempo máximo de drenaje (15 minutos por defecto, configurable por puesto), tras el cual el agente pasa a pausado con incidente registrado; reanudación con límite de ritmo y política para el trabajo acumulado durante la pausa (marcar como antiguo, no ejecutar en caliente).
3. **ADR-009 y ADR-010, borrado:** el borrado de un interesado es supresión, no amnesia: una lista de supresión anonimizada que impide volver a tratar al interesado; los fragmentos del índice llevan referencias de interesado para poder borrarlos; el consentimiento se registra con evidencia antes del primer contacto.

## Decisiones que requieren a Jesús

1. Aprobar o rechazar las tres propuestas anteriores (filas ADR-014, ADR-015 y ADR-016 en la base Decisiones, en Propuesto).
2. Fijar el criterio de paridad para pasar los agentes de Bitclick de iagent-platform a AI Workforce (candidato: cuando existan Sala v0, Conector Odoo v0 y Aprobación v0 en producción con un socio de diseño), y hasta entonces mantener el prototipo en producción sin rodajas nuevas salvo correcciones.
3. Traer al repositorio, como registro histórico en `docs/prd/`, las secciones §16 (identidad en cascada), §17 (conocimiento) y §18 (panel del cliente) de `docs/plataforma.md`, que están fuera de git y este informe no ha podido leer.

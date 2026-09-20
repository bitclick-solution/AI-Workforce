VIGENTE

# Especificación · Documento de producto: fichas de finanzas, ventas y atención, administración y Director de IA

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881909a8cccb263eec2b7) · Ciclo 0 (Fase 0 · Definir y validar) · Tipo Producto · Paquetes docs · P0
- Rama: `rebanada/fichas-de-producto`
- Plan de referencia: secciones _El producto que hay que construir_ (los cinco imprescindibles, la experiencia objetivo, principios no negociables, qué se lanza y qué no), _Autonomía y autoaprendizaje_ (niveles por clase de acción, el Director de IA, guardrails en capas, el bucle de autoaprendizaje), _Departamentos y sala común_, _Ciclo de vida sin código_ (catálogo de operaciones, contratar desde una frase, conectar sistemas sin código, roles humanos), _Conocimiento, indicadores y auditoría_ (indicadores por departamento), _Modelo comercial_ (escalera de precios) y _Camino al mercado_ (fases 1 y 2) del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); [ADR-003](../adr/ADR-003.md), [ADR-004](../adr/ADR-004.md), [ADR-005](../adr/ADR-005.md), [ADR-006](../adr/ADR-006.md), [ADR-007](../adr/ADR-007.md), [ADR-009](../adr/ADR-009.md), [ADR-010](../adr/ADR-010.md) y [ADR-011](../adr/ADR-011.md).
- Zona crítica: no. Solo documentación en `docs/` y el `README.md` raíz; no toca `packages/`, `apps/`, `connectors/`, `.github/` ni `.claude/`.

## Objetivo

Cuando esta rebanada está hecha, la fase 1 tiene la definición de producto que necesita para construir el departamento de finanzas y el Director de IA sin volver al plan: una página por ficha con misión, puestos, herramientas mínimas, guardrails por clase de riesgo, niveles iniciales N0 a N3, indicadores y coste estimado, y la experiencia objetivo de diez minutos paso a paso con lo que se mide en cada release. El Diseñador prototipa sobre ella, el Constructor carga las fichas como plantillas de departamento (datos, nunca código) y los socios de diseño la recorren como guion de su primera sesión.

## Paquetes tocados

Solo `docs/`: `docs/producto/` (nuevo: README, cuatro fichas y la experiencia), esta especificación, `docs/prd/README.md` (pasa a SUPERSEDED) y la sección _Estructura_ del `README.md` raíz. Sin código de producto.

## Endpoints, flujos y datos

No aplica. Las fichas nombran las entidades del [modelo de datos v1](../datos/modelo-de-datos-v1.md) en las que se cargan (`departamento`, `puesto`, `version_puesto`, `autorizacion_herramientas`, `indicador`, `disparador`, `propuesta_operacion`) y usan las enumeraciones de `packages/domain` (`CLASES_RIESGO`, `NIVELES`, `TIPOS_OPERACION`); no cambian ninguna.

## Decisiones que el plan no fija

1. **Ubicación.** Las fichas viven en `docs/producto/` y no en el `docs/prd/` de la estructura del plan, por el encargo de la rebanada. `docs/prd/README.md` pasa a `SUPERSEDED por docs/producto/README.md` y el `README.md` raíz enlaza la carpeta nueva.
2. **Una página es un archivo.** Siete secciones por tres puestos con tablas no caben en un A4. Cada ficha es un archivo de menos de 3.000 palabras que se lee de arriba abajo, con el vocabulario común en el README para no repetirlo cuatro veces.
3. **La clase de riesgo se asigna a la acción concreta**, no al puesto ni a la clase de acción, con los cuatro valores de `CLASES_RIESGO` definidos por efecto (reversibilidad, terceros, dinero, personas físicas). Techos en la primera versión: bajo N2; medio N2 con ejecución diferida en la ventana de deshacer; alto N1; crítico N0.
4. **Leer y redactar arrancan en N2.** No producen efectos fuera de la plataforma y su aviso es la entrada de auditoría. Exigir aprobación por lectura haría imposible responder en la sala en el periodo de prueba, que es el paso 4 de la experiencia objetivo del plan. La frase del plan «todas las clases de acción en N1 durante 30 días» se aplica a las clases con efecto externo.
5. **Puestos de ventas y atención y de administración.** El plan solo fija los tres de finanzas; los otros seis salen de los indicadores de negocio que el plan asigna a cada departamento: Atención de leads, Presupuestos y seguimiento, Atención al cliente; Facturas recibidas, Calendario de obligaciones, Notificaciones y trámites.
6. **Regla de conteo de tareas y organización de referencia.** Cada ficha dice qué cuenta como tarea por puesto (una por factura gestionada, por extracto diario, por conversación) sobre una pyme de 40 empleados descrita en el README. Con esa regla, finanzas y administración caben holgados en el plan Departamento y ventas y atención lo llena: es la respuesta provisional a la pregunta del plan sobre si 1.500 tareas cubren un mes real, que los socios de diseño validan en la fase 1.
7. **Acciones que no se ofrecen.** Pagos, remesas y reembolsos, cambios de datos bancarios, alta de proveedores con cuenta, anulaciones y borrados, presentaciones ante la AEAT o la Seguridad Social y el uso del certificado digital son críticos en N0: el agente prepara y una persona ejecuta con sus credenciales. El banco se lee a través del ERP hasta que exista el conector por PSD2; las sedes electrónicas son una puerta.
8. **Personas físicas.** Ningún puesto valora la solvencia de clientes o proveedores que sean personas físicas (autónomos), para no entrar en el anexo III del Reglamento de IA; devuelve el estado de sus facturas y nada más.
9. **El Director de IA no lee contenido del cliente.** Razona sobre metadatos (volúmenes, escalados, consumo); la simulación en sombra la ejecuta el puesto propuesto en el sandbox. Umbrales de evidencia y límites de propuestas con valores concretos (tres por departamento y cinco por organización y semana), presupuesto propio de 80 tareas ligeras al mes, sin ascensos a N2 en operaciones de riesgo alto en la primera versión. Va incluido en todos los planes con contador aparte y sin descontar del cupo de tareas del cliente: lo decidió Jesús el 2026-09-20 al cerrar la pregunta abierta de esta especificación; es candidata a nota en la revisión del ADR-003 y del ADR-011 del miércoles 23.
10. **Horas liberadas sin salarios.** Las fichas dan horas al mes; el panel las valora con el coste hora que configura cada organización. Ventanas de deshacer concretas por tipo de mensaje: 10 minutos para respuestas a clientes, 2 horas laborables para recordatorios y acuses, 24 horas para pausas por incidente.

## Criterios de hecho

1. `docs/producto/` contiene seis archivos (`README.md`, `finanzas.md`, `ventas-y-atencion.md`, `administracion.md`, `director-de-ia.md`, `experiencia-de-diez-minutos.md`) y cada uno empieza por la línea `VIGENTE`.
2. Cada ficha tiene, en este orden, las secciones `## Misión`, `## Puestos` (`## Puesto y funciones` en el Director), `## Herramientas mínimas`, `## Guardrails por clase de riesgo`, `## Niveles iniciales N0 a N3`, `## Indicadores` y `## Coste estimado`, y tiene menos de 3.000 palabras.
3. Cada ficha cita en su cabecera las secciones del plan v8 y los ADR que la gobiernan, y sus cifras coinciden con ellos: 149 € y 1.500 tareas del plan Departamento y 49 € por 1.000 tareas (ADR-003 y ADR-011); 30 acciones, 95 % sin cambios, 30 días sin incidentes y confirmación humana para N2, N3 fuera del lanzamiento (ADR-005); todo valor de ficha es dato y no código (ADR-006).
4. Las clases de riesgo usan los cuatro valores de `CLASES_RIESGO` y las clases de acción las siete del plan; en cada ficha de departamento, cada par (puesto, clase de acción) tiene nivel inicial y techo, y cada clase de riesgo tiene acciones, guardia de acción y guardia de entrada y salida.
5. Ningún puesto de las tres fichas de departamento ofrece como acción del agente pagos, transferencias, cambios de datos bancarios, borrados ni presentaciones ante la AEAT o la Seguridad Social; las tablas de herramientas mínimas no contienen ninguna operación de ese tipo.
6. La experiencia tiene siete pasos numerados con minuto de inicio y de fin, el último termina en el minuto 10:00, y cada paso dice qué ves, qué hace la plataforma y qué queda en el libro de auditoría y en el contador; una tabla fija las medidas por release con objetivo y cálculo.
7. `pnpm format:check` y `pnpm lint` pasan; `README.md` enlaza `docs/producto/` en _Estructura_; `docs/prd/README.md` empieza por `SUPERSEDED por docs/producto/README.md`.
8. Esta especificación tiene una sola pregunta abierta, al final, y la rebanada en Notion tiene especificación, PR, presupuesto y coste real.

## Casos de prueba y de eval

- Unitario: comprobación con `grep` y `wc` de la línea de estado, de las siete secciones en orden, del límite de palabras y de la ausencia de acciones críticas en las tablas de herramientas; los comandos van en el PR. `pnpm format:check` sobre los Markdown.
- Eval: no aplica. La rebanada no añade comportamiento de agente; cada ficha deja una tarea tipo por puesto como primer caso dorado para `packages/evals` de la fase 1.
- Auditoría y contador: no aplica al código. Cada paso de la experiencia declara qué entradas emite y cuánto suma al contador, y cada ficha exige que toda acción emita entrada.
- Secretos: los documentos no contienen credenciales ni URL con token; el `gitleaks` de la CI lo comprueba en el PR. Las tablas de herramientas repiten que las credenciales no entran en el contexto del modelo.

## Fuera de alcance

- Cargar las fichas como plantillas de departamento y sus casos dorados: rebanadas del ciclo de vida v1 y de evals por puesto de la fase 1.
- Prototipo navegable de la contratación, la sala y la aprobación móvil probado con cinco personas: rebanada del Diseñador de la fase 0.
- Motor de políticas, niveles y guardias de entrada, salida y acción: rebanadas «Políticas y niveles» y «Guardias» de las fases 1 y 2.
- Fichas de departamentos que no se lanzan (compras, RRHH) y el pack de alto riesgo.
- Cambios del modelo comercial: el ADR-011 los revisa el 2026-11-20.

## Presupuesto de tokens

Presupuesto: 30 €, por comparación con «Fábrica de agentes» (solo documentación, 30 € presupuestados y 10 € reales) y por el volumen de esta entrega: seis páginas nuevas redactadas a partir de un plan de 1.200 líneas. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna. La que había, si el Director de IA consume el cupo de tareas del cliente o va incluido en el plan, la resolvió Jesús el 2026-09-20: incluido en todos los planes con presupuesto propio y contador aparte, como el moderador de sala del ADR-004. Las fichas ya lo aplican.

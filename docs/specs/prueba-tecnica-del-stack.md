VIGENTE

# Especificación · Prueba técnica del stack: Temporal, bucle del agente sobre AI SDK y gateway MCP

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881cea07fc0ecb2f9a288) · Ciclo 0 · Tipo Plataforma · Paquetes worker, models, mcp-gateway (más el motor mínimo de políticas en domain y el primer caso dorado en evals) · P0
- Rama: `rebanada/prueba-tecnica-del-stack`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), secciones «Arquitectura» (el bucle del agente es vuestro, la delegación es un flujo hijo, políticas como datos, un libro y un punto de escritura) y «Los primeros diez días»; ADR-002 (stack), ADR-003 (tarea y contador), ADR-004 (delegación), ADR-005 (niveles), ADR-007 (datos); ADR-014 y ADR-015 propuestos por la cosecha del prototipo (`docs/investigacion/cosecha-prototipo.md`).
- Zona crítica: sí. Gateway MCP y credenciales (`packages/mcp-gateway`), motor de políticas y niveles (`packages/domain`), escritura del libro (`packages/ledger` a través de `anotar`). «Revisión humana obligatoria» marcada en la rebanada.
- Arranca cuando «Contador de tareas v0» y «Aprobación por correo y libro v0» estén en `main`: esta prueba consume las dos, no las reimplementa.

## Objetivo

Demostrar en una semana de trabajo que el stack elegido sostiene lo que diferencia al producto: una tarea real de cobros ejecutada como flujo durable con reintentos, un agente que delega en otro como flujo hijo con contrato, un gateway MCP que aplica la lista blanca del puesto e inyecta credenciales sin que el modelo las vea, una aprobación humana que detiene y reanuda el flujo, y cada paso anotado en el libro y sumado al contador. Si el quinto día laborable no hay flujo hijo con reintentos y espera de aprobación funcionando, se para y se escribe el ADR de la alternativa (Restate o Inngest, riesgo «Temporal resulta pesado de operar»).

## Paquetes tocados

- `apps/worker`: flujos de Temporal `tareaAgente` (padre) y `delegacion` (hijo), actividades `pasoModelo`, `pasoHerramienta`, `pedirAprobacion`, `anotarPaso`; reintentos por actividad y proyección del estado a `tarea`.
- `packages/models`: enrutado sobre el AI SDK al proveedor configurado, proveedor de prueba determinista para CI, coste por llamada a partir del uso y una tabla de precios, caché del prompt de la versión de puesto, trazas a Langfuse con tenant, puesto, tarea y versión.
- `packages/mcp-gateway`: registro de servidores MCP por conector, descubrimiento de herramientas, lista blanca y nivel por clase de acción desde `autorizacion_herramientas`, inyección de credenciales desde `conector.referencia_secreto`, registro de cada llamada.
- `packages/domain`: motor mínimo de políticas: decide por clase de acción (lectura o escritura) y nivel N0 a N3 si un paso ejecuta, pide aprobación o se simula; presupuesto y parada al 100 %.
- `packages/evals`: primer caso dorado por puesto (`puestos/cobros`).
- Conector de demostración: un servidor MCP en `connectors/demo` con las dos herramientas de Odoo (`listar_facturas_vencidas`, `crear_nota_seguimiento`) sobre datos de prueba y un fallo inyectable, para que la prueba y la CI no dependan del acceso a Odoo.

Toca cuatro paquetes y una aplicación. Se acepta porque es una prueba de integración cuyas partes no tienen valor por separado; el Revisor revisa el PR paquete a paquete.

## Endpoints, flujos y datos

Sin endpoints nuevos. Dos puestos de Finanzas sembrados por script, no por la sala: «Cobros» (activo, lectura N3, escritura N1) y «Conciliación» (en prueba). Flujo `tareaAgente`: (1) el bucle planificar, llamar herramienta, evaluar y decidir sobre las primitivas del AI SDK, con ganchos antes y después de cada paso: política, presupuesto, guardias (interfaces con implementación nula salvo la regla «ningún secreto en la salida»), auditoría y señal; (2) `listar_facturas_vencidas` por el gateway; (3) por cada factura, `crear_nota_seguimiento` es escritura N1: se crea una fila en `aprobacion` con borrador opaco y resumen legible, el flujo espera la señal de decisión (la produce Aprobación v0; en esta prueba también un mandato `pnpm --filter @aiw/worker decidir <id> aprobada|rechazada|editada`), y ejecuta, salta o ejecuta el borrador editado; (4) delega la conciliación de una factura al puesto «Conciliación» como flujo hijo con contrato (`delegacion`: encargo, plazo, presupuesto acotado al restante del padre, formato) y, si el ADR-014 se aprueba, caducidad y política de respaldo; (5) el resultado del hijo vuelve como señal y su coste suma en la tarea raíz; (6) cada paso llama a `anotar` con puesto, versión, tarea, herramienta, resultado, coste, duración y nivel aplicado, y la tarea completa suma una tarea al contador. Estado de `tarea` como proyección desde el historial de Temporal, reconstruible. Claves de idempotencia por paso para que una reanudación no repita una llamada ya ejecutada. Un puesto en estado `en_prueba` no ejecuta herramientas de escritura: el paso queda registrado como simulado.

## Criterios de hecho

1. `pnpm --filter @aiw/worker demo:cobros` sobre el Compose de desarrollo y el conector de demostración ejecuta el flujo de punta a punta: tres facturas vencidas, una aprobación por nota, espera, decisión, delegación de una conciliación al flujo hijo, resultado devuelto y tarea completada con su coste impreso.
2. Durabilidad y reintentos: una prueba mata el proceso del worker tras el segundo paso y lo reinicia; el flujo continúa desde el historial sin repetir ninguna llamada a herramienta ya ejecutada. El conector de demostración falla la primera llamada y la actividad reintenta con espera creciente hasta tres veces; al cuarto fallo la tarea pasa a `fallida` con el motivo en `resultado`.
3. Delegación: el flujo hijo recibe el contrato completo, `delegacion.tarea_destino_id` queda enlazado, su coste suma en `tarea_raiz_id`, y si supera el plazo el padre aplica la política de respaldo (ADR-014) o marca la delegación como fallida sin bloquearse.
4. Gateway: el agente solo ve las herramientas de `lista_blanca` de su puesto; una llamada a una herramienta no listada se rechaza y se anota como `rechazado`; el secreto del conector se resuelve por `referencia_secreto` y una prueba comprueba que su valor no aparece en ningún mensaje enviado al modelo ni en ninguna traza; cada llamada deja entrada de auditoría con la herramienta.
5. Políticas: lectura N3 ejecuta; escritura N1 crea la aprobación y espera; `aprobada` ejecuta, `rechazada` salta y emite señal, `editada` ejecuta el borrador editado; el puesto en prueba no ejecuta escrituras; al alcanzar el presupuesto de la tarea, el bucle se detiene con estado `esperando_aprobacion` y una aprobación de ampliación.
6. Libro y contador: cada paso y la tarea completa están en `entrada_auditoria` con versión de puesto y nivel aplicado; `contador_consumo` cuadra con las entradas; la cadena verifica.
7. Modelos: el proveedor de prueba hace la CI determinista y sin coste; con proveedor real, el coste por paso sale del uso y de la tabla de precios, la traza en Langfuse lleva tenant, puesto, tarea y versión, y el prompt de la versión de puesto entra en caché.
8. La CI ejecuta los criterios 2 a 6 con `@temporalio/testing` y PostgreSQL de servicio; el primer caso dorado del puesto Cobros pasa en `pnpm evals:smoke`; la demo del viernes queda grabada.

## Casos de prueba y de eval

- Unitario: tabla de decisión del motor de políticas (clase × nivel × estado del puesto); parada por presupuesto; validación Zod del contrato de delegación; lista blanca y clasificación de herramientas; cálculo de coste con la tabla de precios.
- Integración: entorno de pruebas de Temporal con salto de tiempo: reanudación tras caída, reintentos con espera, flujo hijo con contrato y plazo vencido, espera y señal de aprobación, proyección del estado; gateway contra el conector de demostración.
- Eval: caso dorado `cobros`: dada la lista de facturas de prueba, el agente propone una nota de seguimiento correcta por factura y no propone ninguna para las no vencidas.
- Auditoría y contador: prueba de que cada paso deja entrada y de que el contador cuadra; verificación de la cadena al final.
- Secretos: el secreto del conector de demostración llega por `DEMO_CONECTOR_SECRETO` en `.env.example` como `GENERAR`; prueba que rastrea mensajes y trazas en busca de su valor; gitleaks en CI.

## Fuera de alcance

Sala y contratación desde una frase (Sala v0); lección y promoción (Aprendizaje v0); aprobación por correo con enlaces firmados (rebanada en curso; aquí solo la espera y la decisión); conector Odoo real (Conector Odoo v0; el conector de demostración expone las mismas dos herramientas); guardias de entrada y salida con detección de datos personales (servicio `pii`); motor de políticas completo con rangos del Director de IA; panel; agentes de plataforma.

## Presupuesto de tokens

Presupuesto: 80 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

La demo del viernes 2 de octubre, ¿debe correr contra el Odoo real de Bitclick o vale el conector de demostración? Lo primero exige tener «Conector Odoo v0» y el acceso a Odoo de tu rebanada antes del miércoles 30. Si no respondes, la demo va contra el conector de demostración y se repite contra Odoo en cuanto exista el conector.

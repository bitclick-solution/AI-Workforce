VIGENTE

# Especificación · Bitclick como primera organización: Cobros sobre una empresa de pruebas de su Odoo, en el entorno local

- Rebanada: [Notion](https://app.notion.com/p/3e553066189881d58598d33c0460eb7c) · Ciclo 1 · Tipo Producto · Paquetes `connectors/odoo`, `apps/platform-agents`, `apps/worker`, `apps/channels` · P0
- Rama: `rebanada/bitclick-cobros-odoo-pruebas`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), tabla de «Replanteamiento» (primeros conectores Odoo y Factusol: «Odoo es dogfooding real») y «Ciclo de vida sin código» › «Estados de un agente» («en prueba: activo con todas las clases de acción en N1 durante 30 días»); [ADR-024](../adr/ADR-024.md) (empresa de pruebas nueva dentro del Odoo real de Bitclick, usuario de permisos mínimos con esa empresa como única permitida, clientes ficticios con correo que controla Jesús, comprobación previa de registros compartidos). Parte de lo ya fusionado: [Conector Odoo v0](conector-odoo-v0.md) (PR #18), [Aprobación por correo v0](aprobacion-por-correo-v0.md), [Contador de tareas v0](contador-de-tareas-v0.md), [Entorno local](entorno-local.md) y [Acceso al panel](acceso-al-panel.md). Decisión de Jesús del 30-9-2026: prepara él mismo la empresa de pruebas y el usuario de permisos mínimos dentro del Odoo real, antes de que el Constructor empiece.
- Zona crítica: sí — ya marcada en la rebanada. Es la primera conexión de la plataforma a un sistema externo real (el Odoo de producción de Bitclick, aunque solo a su empresa de pruebas) con credenciales reales y clientes reales, y el primer uso continuado del libro y del contador fuera de una demostración. No toca código de `packages/mcp-gateway`, `packages/domain` ni `packages/ledger`, y no hay migración. «Revisión humana obligatoria» marcada en la rebanada y «Zona crítica: sí» en el PR.

## Objetivo

Bitclick deja de trabajar contra datos de demostración: el puesto de Cobros, sembrado en una organización persistente de Bitclick en el entorno local de Jesús, factura de verdad contra una empresa de pruebas nueva dentro del Odoo real de Bitclick (ADR-024), con un usuario de permisos mínimos cuya única empresa permitida es esa. Jesús recibe y aprueba por correo real los recordatorios que el agente propone, y cada paso queda en el libro de auditoría y en el contador. Tras una semana de uso hay un informe con tareas, aprobadas sin cambios y coste: la primera evidencia real con la que decidir cuándo migrar los agentes actuales de Bitclick a la plataforma.

## Paquetes tocados

- `connectors/odoo`: sin cambio de contrato ni de las dos herramientas ya construidas. Jesús prepara antes la empresa de pruebas y el usuario de permisos mínimos dentro del Odoo real y entrega sus credenciales; el Constructor solo configura el entorno contra ellas y, si lo necesita para dejar constancia verificable, escribe un guion mínimo que ejecute la comprobación de registros compartidos que exige ADR-024 antes de conectar.
- `apps/worker`: siembra de la organización persistente de Bitclick (departamento Finanzas, puesto Cobros desde la plantilla `finanzas.reclamacion-de-cobros` en periodo de prueba, con `crear_nota_seguimiento` en N1) y el mecanismo que arranca la tarea contra el conector real de forma repetible durante la semana de uso, reutilizando `crearTareaRaiz` y el flujo `tareaAgente` ya construidos.
- `apps/platform-agents`: sin tocar el prompt ni la plantilla `finanzas.reclamacion-de-cobros`; se usa tal cual, certificada. Si la contratación del puesto se hace desde la sala general (voz ya construida en Sala v0), este paquete no cambia.
- `apps/channels`: configuración de un proveedor SMTP real (ya soportado por el código) para que el correo de aprobación llegue a la bandeja de Jesús en vez de a Mailpit.

## Endpoints, flujos y datos

Sin endpoints nuevos, sin migración. Reutiliza de punta a punta lo ya fusionado: `listar_facturas_vencidas` y `crear_nota_seguimiento` del conector Odoo, el flujo de Temporal `tareaAgente`, `solicitarAprobacion` / `decidir` / `entregarSenal` de la aprobación por correo, y `registrarTareaRaiz` / `registrarUsoDeModelo` del contador. Dato nuevo, no de esquema: la fila de `conector` con `referencia_secreto` apuntando a las credenciales del usuario de permisos mínimos de la empresa de pruebas, y la fila de `autorizacion_herramientas` del puesto de Cobros con `crear_nota_seguimiento` en N1.

## Criterios de hecho

1. Antes de conectar, queda constancia (documento o salida de comando) de qué registros compartidos —contactos y productos sin empresa asignada— ve el usuario de permisos mínimos del MCP en el Odoo real, y de que se les asigna empresa cuando no deban verse desde la de pruebas.
2. La organización Bitclick existe en el entorno local de Jesús como organización persistente (no efímera como las demostraciones), con el departamento Finanzas y el puesto Cobros creado desde la plantilla `finanzas.reclamacion-de-cobros`, en periodo de prueba y con `crear_nota_seguimiento` en N1.
3. El puesto Cobros de Bitclick se conecta por MCP únicamente a la empresa de pruebas del Odoo real: una llamada que intente leer datos de otra empresa falla o vuelve vacía.
4. `listar_facturas_vencidas` sobre la empresa de pruebas solo devuelve facturas de clientes ficticios cuyo correo controla Jesús; ninguna ejecución trae una factura de un cliente real de Bitclick.
5. Cada recordatorio que el agente propone llega a Jesús por correo real, con un enlace de aprobación firmado; aprobarlo ejecuta `crear_nota_seguimiento` en Odoo, rechazarlo no escribe nada.
6. Cada paso —petición al conector, solicitud de aprobación, envío del correo, decisión, escritura en Odoo— deja su entrada en el libro de auditoría con la cadena verificada, y suma al contador del tenant de Bitclick.
7. Tras al menos una semana de uso existe un informe con el número de tareas, cuántas se aprobaron sin cambios y el coste total, generado a partir de las consultas de lectura del contador ya construidas (`tareasDelPeriodo`, `costePorPuesto`), sin tabla nueva.
8. Ninguna credencial del usuario de Odoo ni la clave de firma de aprobación aparece en el repositorio, en un prompt ni en un registro: lo comprueba la misma prueba de secretos que ya cubre `connectors/odoo` y `apps/channels`.
9. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde con los cambios de esta rebanada.

## Casos de prueba y de eval

- Unitario: si esta rebanada añade un guion de comprobación de registros compartidos o de siembra persistente, cada uno con su propia prueba (argumentos, mensaje claro si falta una variable de entorno).
- Eval: sin comportamiento de agente nuevo. El caso dorado `cobros` de la prueba técnica no cambia; en la CI sigue corriendo contra las grabaciones de `connectors/odoo`, y en el entorno de Jesús corre contra el Odoo real.
- Auditoría y contador: criterio de hecho 6, comprobado leyendo el libro y el contador del tenant de Bitclick tras una ejecución real.
- Secretos: criterio de hecho 8.

## Fuera de alcance

- El criterio de paridad para migrar los agentes actuales de Bitclick a la plataforma: lo decide Jesús con el informe de esta rebanada en la mano, no esta rebanada.
- Cambiar el prompt o la plantilla `finanzas.reclamacion-de-cobros`: si hiciera falta, es una rebanada propia y zona crítica de prompts de sistema de los agentes de plataforma.
- Cualquier puesto de Bitclick que no sea Cobros: ADR-024 y la rebanada en Notion fijan solo Cobros.
- Vista en el panel del informe semanal: nace aquí como consulta y registro operativo; su pantalla es la rebanada «Inicio (oficina)».
- El conector de demostración `connectors/demo`: sigue sirviendo la prueba técnica del stack sin cambios.

## Presupuesto de tokens

Presupuesto: 30 €, ya fijado en el tablero. Referencia: «Conector Odoo v0» costó 40 € construyendo el adaptador completo desde cero; esta rebanada lo reutiliza tal cual y añade siembra persistente, configuración y un informe de lectura, así que un presupuesto menor es razonable. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

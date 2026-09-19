VIGENTE

# Especificación · <nombre de la rebanada>

<!-- Una página. La escribe el Planificador cuando la rebanada está en Propuesta o el Constructor antes de la primera línea de código. El nombre del archivo coincide con la rama: docs/specs/<rebanada>.md ↔ rebanada/<rebanada>. -->

- Rebanada: [Notion](<enlace a la rebanada>) · Ciclo <n> · Tipo <Producto | Plataforma | Conector | Cumplimiento | Datos | Operación | Investigación | Comercial | Decisión | Diseño> · Paquetes <lista> · <P0 | P1 | P2>
- Rama: `rebanada/<nombre>`
- Plan de referencia: secciones del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn) y ADR que aplican.
- Zona crítica: <no | sí: cuál>. Si es sí, marca "Revisión humana obligatoria" en la rebanada.

## Objetivo

<!-- Dos o tres frases: qué cambia para el usuario o para el equipo cuando esta rebanada está hecha. -->

## Paquetes tocados

<!-- Lista de apps, packages, connectors o services. Si son más de tres, la rebanada es demasiado grande. -->

## Endpoints, flujos y datos

<!-- Solo si aplica: rutas de la API, flujos de Temporal, tablas o migraciones. Una migración convierte la rebanada en zona crítica. -->

## Criterios de hecho

1. <!-- Observable y verificable: "X devuelve Y", "la CI ejecuta Z". -->
2.
3.

## Casos de prueba y de eval

- Unitario: <!-- caminos de éxito y de error, reintentos del flujo. -->
- Eval: <!-- un caso dorado nuevo por comportamiento de agente añadido; la certificación del puesto no baja. -->
- Auditoría y contador: <!-- qué entradas emite cada acción y cómo se comprueba. -->
- Secretos: <!-- prueba de que ninguna credencial entra en código, prompts ni registros. -->

## Fuera de alcance

<!-- Lo que se parece pero pertenece a otra rebanada, con su nombre. -->

## Presupuesto de tokens

Presupuesto: <n> €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

<!-- Opcional y una sola. Lo que el plan no cubre y solo Jesús puede decidir. Sigue con lo que no dependa de ella. -->

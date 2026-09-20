VIGENTE

# Activos cosechados del prototipo

Copias de los activos de diseño del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, septiembre de 2026) que la rebanada «Cosecha del prototipo IAGENT-COMPANY» identifica como aprovechables. Son registro histórico: no se editan y su código no migra (ADR-002). Lo que AI Workforce adopta de cada uno, y en qué rebanada, está en `docs/investigacion/cosecha-prototipo.md`; las decisiones derivadas son los ADR-014, ADR-015 y ADR-016.

Cada archivo Markdown y YAML empieza por su origen. El esquema JSON no admite cabecera: su origen es esta tabla.

| Archivo                                                | Origen en el prototipo         | Qué contiene                                                                                         |
| ------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `contrato-en-casillas.md`                              | `conformance/README.md`        | Contrato de worker en ocho casillas, verificado por la suite de conformidad                          |
| `envolvente-de-eventos.md`                             | `contracts/EVENTS.md`          | Bus de eventos: envolvente, nombres en pasado, peticiones con caducidad y política de respaldo       |
| `envolvente-de-eventos.schema.json`                    | `contracts/events.schema.json` | Esquema JSON de la envolvente de eventos                                                             |
| `cascada-de-identidad.md`                              | `brand/README.md`              | Cascada de identidad organización → departamento → canal → puesto con regla de sutileza              |
| `cascada-de-identidad.visual.yaml`                     | `brand/org/visual.yaml`        | Tokens visuales del nivel organización, con las claves que cada nivel puede sobrescribir             |
| `prototipo-adr-006-contrato-de-worker-y-vigilantes.md` | `adr/ADR-006.md`               | Estandarizar por contrato de worker y construir vigilantes que proponen, nunca aplican               |
| `prototipo-adr-008-pausa-con-drenaje.md`               | `adr/ADR-008.md`               | La pausa como primitiva: activo → drenando → pausado, colas conservadas, caducidad en las peticiones |
| `prototipo-adr-009-cascada-de-identidad.md`            | `adr/ADR-009.md`               | Identidad de marca heredada en cascada para voz y tokens visuales                                    |
| `prototipo-adr-013-una-sola-pluma.md`                  | `adr/ADR-013.md`               | Una sola pluma: el Control API es el único escritor del estado de control                            |
| `prototipo-adr-016-supresion-no-amnesia.md`            | `adr/ADR-016.md`               | Borrado de datos personales: supresión, no amnesia                                                   |
| `prototipo-adr-017-brand-en-la-raiz.md`                | `adr/ADR-017.md`               | La cascada de identidad se centraliza en brand/                                                      |
| `prototipo-adr-018-canal-parametro-de-compilacion.md`  | `adr/ADR-018.md`               | El canal es parámetro de compilación, no un ámbito del registro                                      |
| `prototipo-adr-020-editar-marca-es-proponer-pr.md`     | `adr/ADR-020.md`               | Editar la marca desde el panel es proponer un PR, nunca escribir                                     |

Fuera de esta carpeta quedan, a propósito, el código Python de los blueprints y de la suite de conformidad, los runbooks de despliegue y `docs/conectar-un-worker.md`: son operación del prototipo, no diseño reutilizable.

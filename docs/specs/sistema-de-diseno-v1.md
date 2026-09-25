VIGENTE

# Especificación · Sistema de diseño v1 «Oficina cercana»

- Rebanada: [Notion](https://app.notion.com/p/3e5530661898817b9859cf460cba2e12) · Ciclo actual · Tipo Diseño · Paquetes `ui`, `web` · P0
- Rama: `rebanada/sistema-de-diseno-v1`
- Plan de referencia: [Plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn) y ADR-020 (dirección visual v1 del panel, aprobado el 2026-09-24). Lienzo: [Design](https://claude.ai/artifact/L96FBGK1NR7d7XkkQCupbs), página «F · Oficina cercana».
- Zona crítica: no.

## Objetivo

`packages/ui` deja su base neutra provisional y pasa a los tokens, tipografías y avatares de «Oficina cercana»,
con modo claro y oscuro comprobados en contraste AA. Se añaden los componentes que ADR-020 pide para el panel de
widgets y el panel de avisos, y la sala y el contador ya fusionados se ven con el sistema nuevo.

## Paquetes tocados

- `packages/ui`: tokens, tipografías, avatares y componentes nuevos.
- `apps/web`: tipografías (`next/font`), la página de muestras y el reskin de `/panel/sala` y `/panel/contador`.

## Endpoints, flujos y datos

No aplica: no hay migración ni cambio de API.

## Criterios de hecho

1. Los tokens de «Oficina cercana» sustituyen la base provisional de `packages/ui/src/tema.ts` sin cambiar la API
   pública de los componentes existentes (`BotonProps`, `AvisoProps`, `CampoProps`, `TarjetaProps`, `InsigniaProps`,
   `EstadoProps`, `PorqueProps`).
2. Hay modo claro y oscuro: `packages/ui/src/tema.css` define los tokens en `:root` (claro), los sustituye con
   `prefers-color-scheme: dark` y con `data-tema="oscuro"|"claro"` en `<html>` cuando la persona elige a mano.
3. `packages/ui/src/contraste.test.ts` comprueba el contraste AA (4,5:1) de cada par de texto y fondo del sistema,
   en los dos modos, a partir de la paleta declarada en `packages/ui/src/paleta.ts`.
4. Hay `AvatarDeAgente` (cara, gesto, color pastel y emblema del puesto) y `AvatarDePersona` (iniciales o silueta),
   `TarjetaDeWidget`, `Indicador`, `ListaDeAvisos` y `AvisoDeAprobacion` (aviso «necesita a una persona» con el
   botón Aprobar siempre presente).
5. `/panel/muestras` enseña todos los componentes en los dos modos, con un selector Sistema/Claro/Oscuro.
6. `/panel/sala` y `/panel/contador` usan los tokens y componentes nuevos en vez de las clases de Tailwind escritas
   a mano que traían.

## Casos de prueba y de eval

- Unitario: pruebas de render de cada componente nuevo y de los que se retocaron (`avatar.test.tsx`,
  `tarjeta-de-widget.test.tsx`, `indicador.test.tsx`, `lista-de-avisos.test.tsx`, `aviso-de-aprobacion.test.tsx`,
  más las ya existentes de `componentes.test.tsx`), incluyendo los estados vacíos (`ListaDeAvisos` sin avisos,
  `AvatarDePersona` sin nombre) y el estado de error del contador con su botón «Reintentar».
- Eval: no aplica; esta rebanada no añade comportamiento de agente.
- Auditoría y contador: no aplica; sin escrituras nuevas.
- Secretos: no aplica; sin credenciales.

## Fuera de alcance

- La maqueta isométrica de la oficina y de cada equipo (ADR-020: fase posterior).
- El panel de widgets con orden, tamaño y catálogo reales, y el panel de avisos con la miniatura de la oficina
  (rebanada «Oficina»): aquí solo van sus componentes visuales.
- Los avisos en app y en el navegador (ADR-021).
- El prototipo `/prototipo/*`: no se toca.

## Presupuesto de tokens

Presupuesto: 40 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa
la rebanada a Bloqueada con diagnóstico.

/**
 * Proveedor principal y proveedor de respaldo de `@aiw/models` (ADR-023).
 *
 * Cambiar de proveedor es cambiar el valor de una variable de entorno, nunca
 * código: quien construye el puerto de un papel llama a
 * `puertoAnthropicPrincipalDesdeEntorno` (o a `puertoAnthropicRespaldoDesdeEntorno`
 * para el respaldo) en vez de elegir a mano `clienteVertexDesdeEntorno` /
 * `clienteBedrockDesdeEntorno` y la `plataforma` que le corresponde. `AIW_PROVEEDOR_MODELOS`
 * decide el principal (por defecto `vertex-ue`, ADR-023) y
 * `AIW_PROVEEDOR_MODELOS_RESPALDO` el de respaldo (por defecto `bedrock-ue`).
 *
 * La primera parte no es un proveedor elegible aquí: sigue reservada a los usos
 * internos sin datos de clientes del ADR-017 (`clientePrimeraParteDesdeEntorno`),
 * nunca al tráfico de un tenant, así que no participa del cambio de proveedor en
 * una línea.
 */
import type { PapelModelo, PlataformaModelo, esquemas } from '@aiw/domain';

import { crearAdaptadorAnthropic } from './adaptadores/anthropic.js';
import type { ClienteDeMensajes } from './adaptadores/cliente-mensajes.js';
import {
  clienteBedrockDesdeEntorno,
  clienteVertexDesdeEntorno,
  type Entorno,
} from './adaptadores/clientes.js';
import type { PuertoDeModelo } from './puerto.js';

/** Proveedores que puede nombrar `AIW_PROVEEDOR_MODELOS` / `AIW_PROVEEDOR_MODELOS_RESPALDO`. */
export const PROVEEDORES_MODELO = ['vertex-ue', 'bedrock-ue'] as const;
export type ProveedorModelos = (typeof PROVEEDORES_MODELO)[number];

const PLATAFORMA_DEL_PROVEEDOR: Record<ProveedorModelos, PlataformaModelo> = {
  'vertex-ue': 'vertex-eu',
  'bedrock-ue': 'bedrock-eu',
};

function esProveedorValido(valor: string): valor is ProveedorModelos {
  return (PROVEEDORES_MODELO as readonly string[]).includes(valor);
}

function proveedorDesdeEntorno(
  entorno: Entorno,
  clave: string,
  porDefecto: ProveedorModelos,
): ProveedorModelos {
  const valor = entorno[clave]?.trim();
  if (!valor) return porDefecto;
  if (!esProveedorValido(valor)) {
    throw new Error(
      `${clave}="${valor}" no es un proveedor de modelos válido. Valores admitidos: ` +
        `${PROVEEDORES_MODELO.join(', ')}.`,
    );
  }
  return valor;
}

/** Proveedor principal (ADR-023): `AIW_PROVEEDOR_MODELOS`, por defecto `vertex-ue`. */
export function proveedorPrincipalDesdeEntorno(entorno: Entorno = process.env): ProveedorModelos {
  return proveedorDesdeEntorno(entorno, 'AIW_PROVEEDOR_MODELOS', 'vertex-ue');
}

/** Proveedor de respaldo (ADR-023): `AIW_PROVEEDOR_MODELOS_RESPALDO`, por defecto `bedrock-ue`. */
export function proveedorRespaldoDesdeEntorno(entorno: Entorno = process.env): ProveedorModelos {
  return proveedorDesdeEntorno(entorno, 'AIW_PROVEEDOR_MODELOS_RESPALDO', 'bedrock-ue');
}

/** La `PlataformaModelo` (vocabulario de `identificadores.ts`) de un proveedor. */
export function plataformaDelProveedor(proveedor: ProveedorModelos): PlataformaModelo {
  return PLATAFORMA_DEL_PROVEEDOR[proveedor];
}

/** Cliente real de un proveedor, construido desde el entorno (`clientes.ts`). */
export function clienteDelProveedorDesdeEntorno(
  proveedor: ProveedorModelos,
  entorno: Entorno = process.env,
): ClienteDeMensajes {
  return proveedor === 'vertex-ue'
    ? clienteVertexDesdeEntorno(entorno)
    : clienteBedrockDesdeEntorno(entorno);
}

type ConfiguracionEsfuerzo = Pick<esquemas.ConfiguracionModeloPuesto, 'esfuerzoPorClasePaso'>;

function puertoDelProveedorDesdeEntorno(
  proveedor: ProveedorModelos,
  papel: PapelModelo,
  configuracion: ConfiguracionEsfuerzo,
  entorno: Entorno,
): PuertoDeModelo {
  return crearAdaptadorAnthropic(clienteDelProveedorDesdeEntorno(proveedor, entorno), {
    papel,
    plataforma: plataformaDelProveedor(proveedor),
    configuracion,
  });
}

/**
 * Puerto de Anthropic para un papel, con el proveedor **principal** que diga
 * `AIW_PROVEEDOR_MODELOS` (por defecto `vertex-ue`, ADR-023). Es el punto de
 * entrada que debe usar quien instala el puerto de un puesto: cambiar de
 * proveedor principal es cambiar esa variable, nunca esta llamada.
 */
export function puertoAnthropicPrincipalDesdeEntorno(
  papel: PapelModelo,
  configuracion: ConfiguracionEsfuerzo,
  entorno: Entorno = process.env,
): PuertoDeModelo {
  return puertoDelProveedorDesdeEntorno(
    proveedorPrincipalDesdeEntorno(entorno),
    papel,
    configuracion,
    entorno,
  );
}

/**
 * Puerto de Anthropic para un papel, con el proveedor de **respaldo** que diga
 * `AIW_PROVEEDOR_MODELOS_RESPALDO` (por defecto `bedrock-ue`, ADR-023). Bloque de
 * construcción para quien decida, en su propia rebanada, cómo conmutar del
 * principal al respaldo en tiempo de ejecución (por ejemplo el bucle del agente);
 * esta rebanada no cablea esa conmutación automática.
 */
export function puertoAnthropicRespaldoDesdeEntorno(
  papel: PapelModelo,
  configuracion: ConfiguracionEsfuerzo,
  entorno: Entorno = process.env,
): PuertoDeModelo {
  return puertoDelProveedorDesdeEntorno(
    proveedorRespaldoDesdeEntorno(entorno),
    papel,
    configuracion,
    entorno,
  );
}

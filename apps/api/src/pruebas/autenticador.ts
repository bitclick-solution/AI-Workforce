/**
 * Autenticador WebAuthn de software, solo para pruebas.
 *
 * Hace lo que haría el llavero del sistema operativo con una passkey: guarda una
 * clave P-256, responde al registro con una atestación `none` y firma los retos de
 * inicio de sesión. Así la prueba recorre el camino entero de Better Auth y de
 * `@simplewebauthn/server` —origen, rpID, reto, firma y contador— sin navegador.
 *
 * No entra en el camino de producción.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function cabecera(tipoMayor: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(tipoMayor << 5) | n]);
  if (n < 256) return Buffer.from([(tipoMayor << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (tipoMayor << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}

/** CBOR mínimo: enteros, texto, bytes y mapas, que es lo que usa WebAuthn. */
export function cbor(valor: Cbor): Buffer {
  if (typeof valor === 'number') return valor >= 0 ? cabecera(0, valor) : cabecera(1, -1 - valor);
  if (typeof valor === 'string') {
    const bytes = Buffer.from(valor, 'utf8');
    return Buffer.concat([cabecera(3, bytes.length), bytes]);
  }
  if (valor instanceof Uint8Array) return Buffer.concat([cabecera(2, valor.length), valor]);
  const partes = [cabecera(5, valor.size)];
  for (const [clave, contenido] of valor) partes.push(cbor(clave), cbor(contenido));
  return Buffer.concat(partes);
}

const b64u = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest();

export class AutenticadorDePrueba {
  readonly credencialId = randomBytes(16);
  readonly #privada: KeyObject;
  readonly #publica: KeyObject;
  #contador = 0;

  constructor(
    readonly rpId: string,
    readonly origen: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.#privada = privateKey;
    this.#publica = publicKey;
  }

  #datosDeCliente(tipo: 'webauthn.create' | 'webauthn.get', reto: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type: tipo, challenge: reto, origin: this.origen, crossOrigin: false }),
    );
  }

  /** Respuesta al registro (`navigator.credentials.create`). */
  registrar(reto: string): Record<string, unknown> {
    const jwk = this.#publica.export({ format: 'jwk' });
    const claveCose = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]),
    );
    const longitud = Buffer.alloc(2);
    longitud.writeUInt16BE(this.credencialId.length);
    const datosAutenticador = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]), // presencia, verificación y datos de credencial
      Buffer.alloc(4), // contador 0
      Buffer.alloc(16), // aaguid anónimo
      longitud,
      this.credencialId,
      claveCose,
    ]);
    const atestacion = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', datosAutenticador],
      ]),
    );
    return {
      id: b64u(this.credencialId),
      rawId: b64u(this.credencialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(this.#datosDeCliente('webauthn.create', reto)),
        attestationObject: b64u(atestacion),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** Respuesta al inicio de sesión (`navigator.credentials.get`). */
  firmar(reto: string): Record<string, unknown> {
    this.#contador += 1;
    const contador = Buffer.alloc(4);
    contador.writeUInt32BE(this.#contador);
    const datosAutenticador = Buffer.concat([sha256(this.rpId), Buffer.from([0x05]), contador]);
    const datosDeCliente = this.#datosDeCliente('webauthn.get', reto);
    const firma = sign(
      'sha256',
      Buffer.concat([datosAutenticador, sha256(datosDeCliente)]),
      this.#privada,
    );
    return {
      id: b64u(this.credencialId),
      rawId: b64u(this.credencialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64u(datosDeCliente),
        authenticatorData: b64u(datosAutenticador),
        signature: b64u(firma),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}

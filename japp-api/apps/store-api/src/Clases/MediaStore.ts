import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Archivos de la segunda pantalla en el disco del servidor de la tienda: <MEDIA_DIR>/<id> (id = UUID del registro de
 * display_media). Se escribe primero en <id>.part con su sha256 y su tamaño, y solo al terminar se renombra: un corte
 * a medias nunca deja un archivo a la vista. Sin MEDIA_DIR (pruebas), una carpeta temporal.
 */
export class MediaStore {
  readonly dir: string;
  constructor(dir?: string) {
    this.dir = resolve(dir || join(tmpdir(), "japp-media"));
  }
  private path(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      throw new Error("id de archivo no válido");
    }
    return join(this.dir, id);
  }
  /** Guarda el flujo; si pasa de `max` bytes para y devuelve tooLarge (no deja nada). */
  async save(id: string, src: Readable, max: number): Promise<{ size: number; sha256: string; tooLarge: boolean }> {
    await mkdir(this.dir, { recursive: true });
    const part = `${this.path(id)}.part`;
    const hash = createHash("sha256");
    let size = 0;
    let tooLarge = false;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) {
          tooLarge = true;
          cb(new Error("TOO_LARGE"));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(src, meter, createWriteStream(part));
    } catch (e) {
      await rm(part, { force: true });
      if (tooLarge) {
        src.resume?.(); // que el resto de la subida se descarte sin colgar la conexión
        return { size, sha256: "", tooLarge: true };
      }
      throw e;
    }
    await rename(part, this.path(id));
    return { size, sha256: hash.digest("hex"), tooLarge: false };
  }
  async remove(id: string) {
    await rm(this.path(id), { force: true });
  }
  async size(id: string): Promise<number | null> {
    try {
      return (await stat(this.path(id))).size;
    } catch {
      return null;
    }
  }
  read(id: string, range?: { start: number; end: number }) {
    return createReadStream(this.path(id), range);
  }
}

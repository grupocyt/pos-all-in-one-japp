import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Put, Req, Res } from "@nestjs/common";
import { CurrentSession, Public, type Session } from "../Helpers/AuthGuard.js";
import { DisplayService } from "../Services/DisplayService.js";

/** Ajustes › Restaurante › Banners: la segunda pantalla del cliente y sus vídeos e imágenes. */
@Controller()
export class DisplayController {
  constructor(@Inject(DisplayService) private readonly display: DisplayService) {}

  @Get("config/pantalla-cliente")
  async get(@CurrentSession() se: Session) {
    return this.display.get(se);
  }

  @Put("config/pantalla-cliente")
  async put(@CurrentSession() se: Session, @Body() body: unknown) {
    return this.display.put(se, body);
  }

  /** El cuerpo es el archivo tal cual (Content-Type video/* o image/*); el nombre en X-File-Name (codificado como URI). */
  @Post("config/pantalla-cliente/media")
  async upload(
    @CurrentSession() se: Session,
    @Req() req: any,
    @Headers("content-type") contentType?: string,
    @Headers("x-file-name") fileName?: string,
    @Headers("x-duration") duration?: string,
  ) {
    return this.display.upload(se, req.body ?? null, { contentType, fileName, duration });
  }

  @Delete("config/pantalla-cliente/media/:id")
  async remove(@CurrentSession() se: Session, @Param("id") id: string) {
    return this.display.remove(se, id);
  }

  /** El archivo, con Range (el vídeo se puede adelantar). Sin sesión: lo pide la etiqueta <video> de la pantalla. */
  @Public()
  @Get("media/:id")
  async media(@Param("id") id: string, @Req() req: any, @Res() reply: any) {
    const f = await this.display.file(id);
    if (!f) {
      reply.status(404).type("application/json").send({ error: "NOT_FOUND" });
      return;
    }
    reply
      .header("accept-ranges", "bytes")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("etag", `"${f.sha256}"`)
      .type(f.mime);
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2]));
      let end = m[1] && m[2] ? Number(m[2]) : f.size - 1;
      end = Math.min(end, f.size - 1);
      if (start > end || start >= f.size) {
        reply.status(416).header("content-range", `bytes */${f.size}`).send();
        return;
      }
      start = Math.max(0, start);
      reply
        .status(206)
        .header("content-range", `bytes ${start}-${end}/${f.size}`)
        .header("content-length", end - start + 1)
        .send(this.display.files.read(id, { start, end }));
      return;
    }
    reply.header("content-length", f.size).send(this.display.files.read(id));
  }
}

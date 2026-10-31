import type { ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { logger } from "./logger";

/**
 * Pipe a Google Cloud Storage read stream to one HTTP response.
 *
 * GCS streams may still be waiting for their upstream response when a browser
 * closes its connection. Destroying that PassThrough can make the GCS client's
 * late response callback throw ERR_STREAM_UNABLE_TO_PIPE outside Express.
 * Unpipe and drain instead; the failure remains scoped to the request.
 */
export function streamGcsObject(
  source: Readable,
  res: ServerResponse,
  resource: string,
  errorStatus = 502,
): void {
  let clientDisconnected = res.destroyed || res.writableEnded;
  let sourceFailed = false;

  source.once("error", (err) => {
    if (sourceFailed) return;
    sourceFailed = true;

    if (clientDisconnected || res.destroyed) {
      logger.warn({ err, resource }, "GCS response stream failed after client disconnect");
      return;
    }

    logger.error({ err, resource }, "GCS response stream failed");
    if (!res.headersSent) {
      res.removeHeader("Content-Length");
      res.removeHeader("Content-Range");
      res.removeHeader("Accept-Ranges");
      res.statusCode = errorStatus;
      res.end();
    } else {
      res.destroy();
    }
  });

  res.once("close", () => {
    if (res.writableFinished || clientDisconnected) return;
    clientDisconnected = true;
    source.unpipe(res);
    // Keep the GCS PassThrough alive while its upstream callback settles.
    source.resume();
  });

  if (clientDisconnected) {
    source.resume();
    return;
  }
  source.pipe(res);
}

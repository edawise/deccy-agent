// pasteFilter — stream filter that turns bracketed terminal pastes into ONE
// logical input. Node's readline submits a line at every `\n` even inside a
// bracketed paste, so a pasted multi-line prompt becomes several turns. This
// filter sits between the raw stdin stream and readline: it swallows
// `\x1b[200~` … `\x1b[201~` regions (markers included) and re-emits the
// captured text — newlines intact — as a single `paste` event. Everything
// outside a paste region passes through byte-for-byte, so ordinary typing and
// key handling are unchanged.

import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Enable/disable bracketed paste on the terminal (DECSET 2004). */
export const BRACKETED_PASTE_ON = "\x1b[?2004h";
export const BRACKETED_PASTE_OFF = "\x1b[?2004l";

export class PasteFilter extends Transform {
  private decoder = new StringDecoder("utf8");
  private buf = "";
  private inPaste = false;
  private pasteBuf = "";

  constructor() {
    super();
  }

  override _transform(chunk: Buffer | string, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.buf += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.drain();
    cb();
  }

  override _flush(cb: (error?: Error | null) => void): void {
    this.buf += this.decoder.end();
    this.drain();
    // At EOF, bytes held back for a partial marker are plain text after all.
    this.take(this.buf.length);
    if (this.inPaste) {
      // Stream ended mid-paste: hand over whatever was captured.
      this.inPaste = false;
      const text = this.pasteBuf;
      this.pasteBuf = "";
      if (text) this.emit("paste", text);
    }
    cb();
  }

  /** Scan the pending buffer; push passthrough bytes / capture paste bytes. */
  private drain(): void {
    while (this.buf.length > 0) {
      const marker = this.inPaste ? PASTE_END : PASTE_START;
      const esc = this.buf.indexOf("\x1b");
      if (esc === -1) {
        this.take(this.buf.length);
        continue;
      }
      if (this.buf.startsWith(marker, esc)) {
        this.take(esc);
        // take() already re-based the buffer onto the marker.
        this.buf = this.buf.slice(marker.length);
        if (this.inPaste) {
          this.inPaste = false;
          const text = this.pasteBuf;
          this.pasteBuf = "";
          this.emit("paste", text);
        } else {
          this.inPaste = true;
        }
        continue;
      }
      if (marker.startsWith(this.buf.slice(esc))) {
        // Partial marker at the buffer end (e.g. split across chunks): hold it.
        this.take(esc);
        return;
      }
      // Not our marker (arrow keys etc.): pass the ESC byte through and rescan.
      this.take(esc + 1);
    }
  }

  /** Consume n buffered chars into the paste capture or the passthrough. */
  private take(n: number): void {
    const text = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    if (!text) return;
    if (this.inPaste) this.pasteBuf += text;
    else this.push(text);
  }
}

export interface PasteFilter {
  on(event: "paste", listener: (text: string) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}

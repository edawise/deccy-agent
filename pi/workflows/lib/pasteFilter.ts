// pasteFilter — stream filter between raw stdin and readline, with two jobs:
//
//  1. Bracketed pastes → ONE logical input. Node's readline submits a line at
//     every `\n` even inside a bracketed paste, so a pasted multi-line prompt
//     becomes several turns. This filter swallows `\x1b[200~` … `\x1b[201~`
//     regions (markers included) and re-emits the captured text — newlines
//     intact — as a single `paste` event.
//
//  2. Key-unit interception (keyFilter mode). When `keyFilter` is set, input
//     is decoded into key units (single characters; CSI `ESC[…`, SS3 `ESC O…`
//     and Alt+key sequences) and each unit is offered to the filter FIRST.
//     A swallowed key is emitted as a `menukey` event and never reaches
//     readline — that is how the REPL's "/" menu gets precedence over
//     readline's history/submit handling for Up/Down/Enter/Tab/Esc. A unit
//     held back as possibly-incomplete (a lone ESC, a split sequence) is
//     flushed after a short timeout so single keystrokes are never lost.
//
// Without a keyFilter, everything outside paste regions passes through
// byte-for-byte, so ordinary typing and key handling are unchanged.

import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Enable/disable bracketed paste on the terminal (DECSET 2004). */
export const BRACKETED_PASTE_ON = "\x1b[?2004h";
export const BRACKETED_PASTE_OFF = "\x1b[?2004l";

/** How long an incomplete key unit is held before being flushed as-is. */
const HOLD_MS = 50;

export class PasteFilter extends Transform {
  private decoder = new StringDecoder("utf8");
  private buf = "";
  private inPaste = false;
  private pasteBuf = "";
  private holdTimer: NodeJS.Timeout | null = null;

  /** When set, key units are decoded and offered here first: returning true
   *  swallows the key (it is emitted as `menukey` instead of reaching
   *  readline). Installing it switches the filter to key-unit decoding. */
  keyFilter: ((unit: string) => boolean) | null = null;

  constructor() {
    super();
  }

  override _transform(chunk: Buffer | string, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.buf += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    this.drain();
    cb();
  }

  override _flush(cb: (error?: Error | null) => void): void {
    this.clearHold();
    this.buf += this.decoder.end();
    this.drain(true);
    if (this.inPaste) {
      // Stream ended mid-paste: hand over whatever was captured.
      this.inPaste = false;
      const text = this.pasteBuf;
      this.pasteBuf = "";
      if (text) this.emit("paste", text);
    }
    cb();
  }

  /** Scan the pending buffer: capture pastes, deliver key units or bytes. */
  private drain(final = false): void {
    while (this.buf.length > 0) {
      // Inside a paste, everything up to PASTE_END is captured verbatim.
      if (this.inPaste) {
        const end = this.buf.indexOf(PASTE_END);
        if (end !== -1) {
          this.pasteBuf += this.buf.slice(0, end);
          this.buf = this.buf.slice(end + PASTE_END.length);
          this.inPaste = false;
          const text = this.pasteBuf;
          this.pasteBuf = "";
          if (text) this.emit("paste", text);
          continue;
        }
        const esc = this.buf.indexOf("\x1b");
        if (esc !== -1 && PASTE_END.startsWith(this.buf.slice(esc))) {
          // Possible end marker split across chunks: capture up to it and hold.
          this.pasteBuf += this.buf.slice(0, esc);
          this.buf = this.buf.slice(esc);
          return;
        }
        this.pasteBuf += this.buf;
        this.buf = "";
        return;
      }

      // A paste starting here?
      if (this.buf.startsWith(PASTE_START)) {
        this.buf = this.buf.slice(PASTE_START.length);
        this.inPaste = true;
        continue;
      }
      // ... or the buffer ending inside a possible marker (split chunk)?
      if (!final && PASTE_START.startsWith(this.buf)) {
        this.hold();
        return;
      }

      if (this.keyFilter) {
        // Key-unit mode: decode one unit and let the filter see it first.
        const unit = this.takeUnit(final);
        if (unit === null) return; // incomplete unit held for more input
        if (this.keyFilter(unit)) this.emit("menukey", unit);
        else this.push(unit);
        continue;
      }

      // Plain mode: bytes pass through untouched.
      const esc = this.buf.indexOf("\x1b");
      if (esc === -1) {
        this.push(this.buf);
        this.buf = "";
        continue;
      }
      if (esc > 0) {
        this.push(this.buf.slice(0, esc));
        this.buf = this.buf.slice(esc);
        continue;
      }
      // Not our marker (arrow keys etc.): pass the ESC byte through and rescan.
      this.push("\x1b");
      this.buf = this.buf.slice(1);
    }
  }

  /** One key unit from the buffer; null = incomplete (held, unless final). */
  private takeUnit(final: boolean): string | null {
    const b = this.buf;
    if (!b.startsWith("\x1b")) {
      this.buf = b.slice(1);
      return b[0];
    }
    if (b.startsWith("\x1b[") || b.startsWith("\x1bO")) {
      const m = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(b) ?? /^\x1bO[@-~]/.exec(b);
      if (m) {
        this.buf = b.slice(m[0].length);
        return m[0];
      }
      if (!final) {
        this.hold();
        return null;
      }
      this.buf = b.slice(1);
      return "\x1b";
    }
    if (b[1] === "\r" || b[1] === "\n") {
      // Esc right before Enter is two keystrokes, not Alt+Enter.
      this.buf = b.slice(1);
      return "\x1b";
    }
    if (b.length >= 2) {
      // Alt+key: ESC plus one character.
      this.buf = b.slice(2);
      return b.slice(0, 2);
    }
    if (!final) {
      this.hold();
      return null;
    }
    this.buf = "";
    return "\x1b";
  }

  /** Hold buffered bytes for a beat: a split sequence or lone ESC may follow. */
  private hold(): void {
    if (this.holdTimer || !this.keyFilter) return;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.drain(true);
    }, HOLD_MS);
    this.holdTimer.unref?.();
  }

  private clearHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
}

export interface PasteFilter {
  on(event: "paste", listener: (text: string) => void): this;
  on(event: "menukey", listener: (unit: string) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}

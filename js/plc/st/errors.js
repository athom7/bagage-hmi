// Error type for the Structured Text toolchain. Messages are shown to the user, so they are in Danish.

export class STError extends Error {
  constructor(message, line = 0, col = 0, kind = 'syntax') {
    super(line ? `Linje ${line}: ${message}` : message);
    this.name = 'STError';
    this.rawMessage = message;
    this.line = line;
    this.col = col;
    this.kind = kind; // 'syntax' | 'type' | 'runtime'
  }
}

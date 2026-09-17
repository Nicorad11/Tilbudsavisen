export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} fra ${url}`);
    this.name = 'HttpError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt tillader ikke ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

/** Kastes når en kilde svarer, men data ikke længere har den forventede form. */
export class StructureChangedError extends Error {
  constructor(
    readonly sourceId: string,
    message: string,
  ) {
    super(message);
    this.name = 'StructureChangedError';
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

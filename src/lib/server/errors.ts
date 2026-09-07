/** Error carrying an HTTP status, thrown by services and mapped by the API/actions. */
export class HttpError extends Error {
  status: number;
  /** Optional per-field messages (form field name -> message) for form rendering. */
  fields: Record<string, string>;
  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const badRequest = (msg: string, fields: Record<string, string> = {}) => new HttpError(400, msg, fields);
export const notFound = (msg = 'Ikke fundet') => new HttpError(404, msg);
/** 409: mutation attempted on an immutable (issued) document, or a sequence conflict. */
export const conflict = (msg: string) => new HttpError(409, msg);
